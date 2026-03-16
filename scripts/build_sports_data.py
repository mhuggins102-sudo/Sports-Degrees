import json
from pathlib import Path
import pandas as pd

print("🔄 Building offline MLB + NFL data...")


def disambiguate_names(id_col, name_col, debut_col, df):
    """Detect duplicate display names and disambiguate with Jr./Sr. or debut year.

    Returns a dict mapping id → display_name.
    """
    # Build id → (name, debut_year) mapping
    id_info = {}
    for _, row in df.drop_duplicates(subset=[id_col]).iterrows():
        pid = row[id_col]
        name = row[name_col]
        debut = int(row[debut_col]) if pd.notna(row[debut_col]) else 9999
        id_info[pid] = (name, debut)

    # Find duplicate names
    from collections import defaultdict
    name_to_ids = defaultdict(list)
    for pid, (name, debut) in id_info.items():
        name_to_ids[name].append((pid, debut))

    # Disambiguate
    id_to_display = {}
    for name, entries in name_to_ids.items():
        if len(entries) == 1:
            id_to_display[entries[0][0]] = name
        elif len(entries) == 2:
            entries.sort(key=lambda x: x[1])  # sort by debut
            gap = entries[1][1] - entries[0][1]
            if gap >= 15:
                id_to_display[entries[0][0]] = f"{name} Sr."
                id_to_display[entries[1][0]] = f"{name} Jr."
            else:
                for pid, debut in entries:
                    id_to_display[pid] = f"{name} ({debut})"
        else:
            for pid, debut in entries:
                id_to_display[pid] = f"{name} ({debut})"

    return id_to_display


# === MLB (only the two CSVs we need) ===
lahman_dir = Path("./lahman")
people_file = lahman_dir / "People.csv"
appearances_file = lahman_dir / "Appearances.csv"

if not people_file.exists() or not appearances_file.exists():
    print("❌ Missing files!")
    print("   Put People.csv and Appearances.csv inside a folder named 'lahman/'")
    print("   Download from: https://sabr.org/lahman-database/")
    exit(1)

print("✅ Found Lahman CSVs → processing...")

people = pd.read_csv(people_file, usecols=["playerID", "nameFirst", "nameLast", "debut"], dtype=str)
people["fullName"] = (people["nameFirst"].fillna("") + " " + people["nameLast"].fillna("")).str.strip()
people = people[people["fullName"].str.len() > 3]

appearances = pd.read_csv(appearances_file, usecols=["playerID", "yearID", "teamID"])
df = appearances.merge(people[["playerID", "fullName", "debut"]], on="playerID")
df = df.dropna(subset=["fullName", "yearID", "teamID"]).copy()

# Extract debut year from the debut date string (e.g. "1973-04-06" → 1973)
df["debutYear"] = df["debut"].str[:4]

# Disambiguate duplicate names using playerID
mlb_id_to_name = disambiguate_names("playerID", "fullName", "debutYear", df)
df["displayName"] = df["playerID"].map(mlb_id_to_name)
dupes = sum(1 for v in mlb_id_to_name.values() if "Jr." in v or "Sr." in v or "(" in v)
print(f"   Disambiguated {dupes} players with duplicate names")

mlb_player_seasons = {}
for pid, group in df.groupby("playerID"):
    display = mlb_id_to_name[pid]
    mlb_player_seasons[display] = [
        {"team": str(row["teamID"]), "year": int(row["yearID"])}
        for _, row in group.iterrows()
    ]

mlb_team_seasons = {}
for (team, year), group in df.groupby(["teamID", "yearID"]):
    key = f"{team}-{int(year)}"
    mlb_team_seasons[key] = sorted(set(group["displayName"].tolist()))

mlb_data = {
    "players": sorted(mlb_player_seasons.keys()),
    "playerSeasons": mlb_player_seasons,
    "teamSeasons": mlb_team_seasons
}

# === NFL: Modern data (1999-2025) via nfl_data_py ===
import nfl_data_py as nfl
print("✅ Processing NFL modern data (1999-2025)...")
years = list(range(1999, 2026))
rosters = nfl.import_seasonal_rosters(years)

# Use player_name for the full "First Last" display name
rosters["fullName"] = rosters["player_name"].fillna("").str.strip()

# Modern NFL data has player_id — use it to disambiguate same-name players
rosters["debutYear"] = rosters.groupby("player_id")["season"].transform("min")
nfl_modern_id_to_name = disambiguate_names("player_id", "fullName", "debutYear", rosters[rosters["fullName"].str.len() >= 4])
rosters["displayName"] = rosters["player_id"].map(nfl_modern_id_to_name)

nfl_player_seasons = {}
for pid, group in rosters.groupby("player_id"):
    display = nfl_modern_id_to_name.get(pid)
    if not display or len(display.strip()) < 4:
        continue
    nfl_player_seasons[display] = [
        {"team": str(row["team"]), "year": int(row["season"])}
        for _, row in group.iterrows()
    ]

nfl_team_seasons = {}
for (team, year), group in rosters.groupby(["team", "season"]):
    key = f"{team}-{int(year)}"
    nfl_team_seasons[key] = sorted(set(group["displayName"].dropna().tolist()))

# Extract each player's most common depth_chart_position across their career
nfl_player_positions = {}
for pid, group in rosters.groupby("player_id"):
    display = nfl_modern_id_to_name.get(pid)
    if not display or len(display.strip()) < 4:
        continue
    pos_series = group["depth_chart_position"].dropna()
    if not pos_series.empty:
        nfl_player_positions[display] = pos_series.value_counts().index[0]

modern_dupes = sum(1 for v in nfl_modern_id_to_name.values() if "Jr." in v or "Sr." in v or "(" in v)
print(f"   Disambiguated {modern_dupes} modern players with duplicate names")

# === NFL: Historical data (1966-1998) from pre-downloaded CSV ===
hist_file = Path("./scripts/historical_nfl_rosters.csv")
if hist_file.exists():
    print("✅ Merging historical NFL data (1966-1998)...")
    hist = pd.read_csv(hist_file, dtype={"season": int})
    hist = hist[hist["season"] <= 1998]  # nfl_data_py is authoritative for 1999+

    # For historical data, we don't have unique player IDs.
    # Group by name, detect collisions via career gap, and split.
    hist_player_seasons_raw = {}
    hist_positions_raw = {}
    for name, group in hist.groupby("player_name"):
        if len(name.strip()) < 4:
            continue
        seasons = [
            {"team": str(row["team"]), "year": int(row["season"])}
            for _, row in group.iterrows()
        ]
        hist_player_seasons_raw[name] = seasons
        pos_series = group["position"].dropna()
        if not pos_series.empty:
            hist_positions_raw[name] = pos_series.value_counts().index[0]

    # Split historical names with career gaps > 5 years into separate entries
    hist_player_seasons = {}
    hist_player_positions = {}
    for name, seasons in hist_player_seasons_raw.items():
        years_sorted = sorted(set(s["year"] for s in seasons))
        # Check for gaps
        split_points = []
        for i in range(1, len(years_sorted)):
            if years_sorted[i] - years_sorted[i - 1] > 5:
                split_points.append(i)

        if not split_points:
            hist_player_seasons[name] = seasons
            if name in hist_positions_raw:
                hist_player_positions[name] = hist_positions_raw[name]
        else:
            # Split into clusters
            boundaries = [0] + split_points + [len(years_sorted)]
            clusters = []
            for j in range(len(boundaries) - 1):
                cluster_years = set(years_sorted[boundaries[j]:boundaries[j + 1]])
                cluster_seasons = [s for s in seasons if s["year"] in cluster_years]
                debut = min(cluster_years)
                clusters.append((debut, cluster_seasons))

            if len(clusters) == 2 and clusters[1][0] - clusters[0][0] >= 15:
                labels = [f"{name} Sr.", f"{name} Jr."]
            else:
                labels = [f"{name} ({c[0]})" for c in clusters]

            for label, (_, cluster_seasons) in zip(labels, clusters):
                hist_player_seasons[label] = cluster_seasons
                if name in hist_positions_raw:
                    hist_player_positions[label] = hist_positions_raw[name]

    # Merge historical into modern, tracking renames so we can update teamSeasons
    modern_renames = {}  # old_name → new_name for players renamed during merge
    for name, seasons in hist_player_seasons.items():
        if name in nfl_player_seasons:
            # Same name exists in modern — check if it's the same player (careers overlap/adjacent)
            modern_years = set(s["year"] for s in nfl_player_seasons[name])
            hist_years = set(s["year"] for s in seasons)
            gap = min(modern_years) - max(hist_years) if modern_years and hist_years else 999
            if gap <= 5:
                # Same player spanning eras — merge
                nfl_player_seasons[name] = seasons + nfl_player_seasons[name]
            else:
                # Different player — disambiguate
                hist_debut = min(hist_years)
                modern_debut = min(modern_years)
                if f"{name} Sr." not in nfl_player_seasons and hist_debut + 15 <= modern_debut:
                    hist_label = f"{name} Sr."
                    modern_label = f"{name} Jr."
                else:
                    hist_label = f"{name} ({hist_debut})"
                    modern_label = f"{name} ({modern_debut})"
                # Rename modern entry
                nfl_player_seasons[modern_label] = nfl_player_seasons.pop(name)
                if name in nfl_player_positions:
                    nfl_player_positions[modern_label] = nfl_player_positions.pop(name)
                modern_renames[name] = modern_label
                # Add historical entry
                nfl_player_seasons[hist_label] = seasons
                if name in hist_player_positions:
                    nfl_player_positions[hist_label] = hist_player_positions[name]
        else:
            nfl_player_seasons[name] = seasons

    # Apply renames to modern teamSeasons
    if modern_renames:
        for key in nfl_team_seasons:
            nfl_team_seasons[key] = [modern_renames.get(p, p) for p in nfl_team_seasons[key]]

    # Build historical teamSeasons using disambiguated names.
    # Pre-build a fast lookup: (original_name, team, year) → display_name
    orig_to_display = {}
    for display, seasons in nfl_player_seasons.items():
        # Extract original name (strip Sr./Jr./year suffix)
        base = display.split(" (")[0]
        if base.endswith(" Sr."):
            base = base[:-4]
        elif base.endswith(" Jr."):
            base = base[:-4]
        for s in seasons:
            orig_to_display[(base, s["team"], s["year"])] = display

    for (team, year), group in hist.groupby(["team", "season"]):
        key = f"{team}-{int(year)}"
        display_names = set()
        for _, row in group.iterrows():
            orig_name = row["player_name"]
            if len(orig_name.strip()) < 4:
                continue
            display = orig_to_display.get((orig_name, str(row["team"]), int(row["season"])), orig_name)
            display_names.add(display)

        names = sorted(display_names)
        if key in nfl_team_seasons:
            nfl_team_seasons[key] = sorted(set(nfl_team_seasons[key] + names))
        else:
            nfl_team_seasons[key] = names

    # Merge historical positions (only for players not already in modern data)
    for name, pos in hist_player_positions.items():
        if name not in nfl_player_positions:
            nfl_player_positions[name] = pos

    hist_players = hist["player_name"].nunique()
    print(f"   Added {hist_players:,} historical players")
else:
    print("⚠️  No historical_nfl_rosters.csv found — run download_historical_nfl.py first")

nfl_data = {
    "players": sorted(nfl_player_seasons.keys()),
    "playerSeasons": nfl_player_seasons,
    "teamSeasons": nfl_team_seasons,
    "playerPositions": nfl_player_positions
}

# === Save compact JSONs ===
data_dir = Path("src/data")
data_dir.mkdir(parents=True, exist_ok=True)

with open(data_dir / "mlb_data.json", "w", encoding="utf-8") as f:
    json.dump(mlb_data, f, separators=(",", ":"))

with open(data_dir / "nfl_data.json", "w", encoding="utf-8") as f:
    json.dump(nfl_data, f, separators=(",", ":"))

print(f"✅ MLB: {len(mlb_data['players']):,} players")
print(f"✅ NFL: {len(nfl_data['players']):,} players")
print("🎉 Files saved to src/data/ — commit these two JSONs (they're only ~4-6 MB each)!")
