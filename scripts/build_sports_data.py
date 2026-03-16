import json
from pathlib import Path
from collections import defaultdict
import pandas as pd

print("🔄 Building offline MLB + NFL data...")

# Position group mapping for disambiguating same-name NFL players
POS_GROUPS = {
    'QB': 'QB', 'RB': 'RB', 'FB': 'RB', 'WR': 'WR', 'TE': 'TE',
    'OL': 'OL', 'OT': 'OL', 'OG': 'OL', 'C': 'OL', 'T': 'OL', 'G': 'OL',
    'DL': 'DL', 'DE': 'DL', 'DT': 'DL', 'NT': 'DL',
    'LB': 'LB', 'ILB': 'LB', 'OLB': 'LB', 'MLB': 'LB',
    'DB': 'DB', 'CB': 'DB', 'S': 'DB', 'SS': 'DB', 'FS': 'DB',
    'K': 'SPEC', 'P': 'SPEC', 'SPEC': 'SPEC', 'LS': 'SPEC',
}


def split_historical_by_position(name, entries):
    """Split entries for a player name using position data when same-year conflicts exist.

    entries: list of {'team': str, 'year': int, 'position': str}
    Returns None if no split needed, or list of (label, seasons, primary_pos) tuples.
    Each season in seasons is {'team': str, 'year': int}.
    """
    # Add position group to each entry
    for e in entries:
        e['pos_group'] = POS_GROUPS.get(e['position'], e.get('position', ''))

    # Group entries by year, check for same-year position conflicts on different teams
    by_year = defaultdict(list)
    for e in entries:
        by_year[e['year']].append(e)

    has_conflict = False
    for year, ents in by_year.items():
        # Group by position group → teams
        pg_teams = defaultdict(set)
        for e in ents:
            pg_teams[e['pos_group']].add(e['team'])
        if len(pg_teams) <= 1:
            continue
        # Check if any two position groups appear on disjoint teams
        pgs = list(pg_teams.items())
        for i, (pg1, teams1) in enumerate(pgs):
            for pg2, teams2 in pgs[i + 1:]:
                if not (teams1 & teams2):
                    has_conflict = True
                    break
            if has_conflict:
                break
        if has_conflict:
            break

    if not has_conflict:
        return None  # no definitive conflicts, use existing gap-based logic

    # Split entries by position group
    by_pg = defaultdict(list)
    for e in entries:
        by_pg[e['pos_group']].append(e)

    # When same-year position conflicts exist, keep each position group separate.
    # Don't try to merge non-overlapping groups — they're likely different players too.
    if len(by_pg) <= 1:
        return None

    clusters = {i: ents for i, (pg, ents) in enumerate(by_pg.items())}

    # Build result: (debut_year, seasons, primary_position_group)
    result = []
    for root, ents in clusters.items():
        debut = min(e['year'] for e in ents)
        seasons = [{'team': e['team'], 'year': e['year']} for e in ents]
        # Primary position: most common position group in this cluster
        pg_counts = defaultdict(int)
        for e in ents:
            pg_counts[e['pos_group']] += 1
        primary_pg = max(pg_counts, key=pg_counts.get)
        result.append((debut, seasons, primary_pg))
    result.sort(key=lambda x: x[0])

    # Generate labels
    if len(result) == 2 and result[1][0] - result[0][0] >= 15:
        labels = [f"{name} Sr.", f"{name} Jr."]
    else:
        labels = [f"{name} ({r[0]})" for r in result]

    return [(label, seasons, pg) for label, (_, seasons, pg) in zip(labels, result)]


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

appearances = pd.read_csv(appearances_file, usecols=[
    "playerID", "yearID", "teamID", "G_all", "GS",
    "G_p", "G_c", "G_1b", "G_2b", "G_3b", "G_ss", "G_lf", "G_cf", "G_rf", "G_of", "G_dh",
])
df = appearances.merge(people[["playerID", "fullName", "debut"]], on="playerID")
df = df.dropna(subset=["fullName", "yearID", "teamID"]).copy()

# Extract debut year from the debut date string (e.g. "1973-04-06" → 1973)
df["debutYear"] = df["debut"].str[:4]

# Disambiguate duplicate names using playerID
mlb_id_to_name = disambiguate_names("playerID", "fullName", "debutYear", df)
df["displayName"] = df["playerID"].map(mlb_id_to_name)
dupes = sum(1 for v in mlb_id_to_name.values() if "Jr." in v or "Sr." in v or "(" in v)
print(f"   Disambiguated {dupes} players with duplicate names")

# Determine primary position for each player from Appearances data
MLB_POS_COLS = {
    "G_p": "P", "G_c": "C", "G_1b": "1B", "G_2b": "2B",
    "G_3b": "3B", "G_ss": "SS", "G_lf": "LF", "G_cf": "CF",
    "G_rf": "RF", "G_of": "OF", "G_dh": "DH",
}
mlb_player_positions = {}
mlb_player_well_known = {}

for pid, group in df.groupby("playerID"):
    display = mlb_id_to_name.get(pid)
    if not display:
        continue

    # Sum games at each position across career
    pos_totals = {}
    for col, pos_label in MLB_POS_COLS.items():
        total = group[col].fillna(0).astype(int).sum()
        if total > 0:
            pos_totals[pos_label] = total

    if pos_totals:
        primary = max(pos_totals, key=pos_totals.get)
        # Consolidate OF subtypes → OF if OF is dominant
        if primary in ("LF", "CF", "RF") and pos_totals.get("OF", 0) > pos_totals[primary]:
            primary = "OF"
        mlb_player_positions[display] = primary

    # Well-known threshold (era-adjusted):
    #   Post-1990 debuts: batters ≥1250 G (~5000 PA), pitchers ≥150 GS or ≥500 G
    #   Pre-1990 debuts: batters ≥1875 G (~7500 PA), pitchers ≥225 GS or ≥750 G
    career_gp = int(group["G_p"].fillna(0).astype(int).sum())
    career_gs = int(group["GS"].fillna(0).astype(int).sum())
    career_g_all = int(group["G_all"].fillna(0).astype(int).sum())
    is_pitcher = (career_gp > career_g_all * 0.5) if career_g_all > 0 else False

    debut_yr = group["debutYear"].dropna().iloc[0] if not group["debutYear"].dropna().empty else "9999"
    is_pre_1990 = int(str(debut_yr)[:4]) < 1990

    if is_pitcher:
        if is_pre_1990:
            well_known = career_gs >= 225 or career_gp >= 750
        else:
            well_known = career_gs >= 150 or career_gp >= 500
    else:
        career_batting_games = career_g_all - career_gp
        if is_pre_1990:
            well_known = career_batting_games >= 1875  # ~7500 PA
        else:
            well_known = career_batting_games >= 1250  # ~5000 PA

    if well_known:
        mlb_player_well_known[display] = True

print(f"   Positions assigned for {len(mlb_player_positions):,} MLB players")
print(f"   {len(mlb_player_well_known):,} MLB players marked as well-known")

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

# Build well-known player list (sorted names)
mlb_well_known_list = sorted(mlb_player_well_known.keys())

mlb_data = {
    "players": sorted(mlb_player_seasons.keys()),
    "playerSeasons": mlb_player_seasons,
    "teamSeasons": mlb_team_seasons,
    "playerPositions": mlb_player_positions,
    "wellKnown": mlb_well_known_list,
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
    # Group by name, then split using position data and career gaps.
    hist_entries_raw = {}  # name → list of {'team', 'year', 'position'}
    for name, group in hist.groupby("player_name"):
        if len(name.strip()) < 4:
            continue
        entries = [
            {"team": str(row["team"]), "year": int(row["season"]),
             "position": str(row["position"]) if pd.notna(row.get("position")) else ""}
            for _, row in group.iterrows()
        ]
        hist_entries_raw[name] = entries

    # Phase 1: Position-aware splitting (handles same-year conflicts)
    # Phase 2: Gap-based splitting for remaining names
    hist_player_seasons = {}
    hist_player_positions = {}
    pos_split_count = 0

    for name, entries in hist_entries_raw.items():
        pos_result = split_historical_by_position(name, entries)
        if pos_result:
            # Position-based split succeeded
            pos_split_count += len(pos_result)
            for label, seasons, primary_pg in pos_result:
                # Also apply gap detection within each position cluster
                years_sorted = sorted(set(s["year"] for s in seasons))
                split_points = []
                for i in range(1, len(years_sorted)):
                    if years_sorted[i] - years_sorted[i - 1] > 5:
                        split_points.append(i)

                if not split_points:
                    hist_player_seasons[label] = seasons
                    hist_player_positions[label] = primary_pg
                else:
                    boundaries = [0] + split_points + [len(years_sorted)]
                    sub_clusters = []
                    for j in range(len(boundaries) - 1):
                        cluster_years = set(years_sorted[boundaries[j]:boundaries[j + 1]])
                        cluster_seasons = [s for s in seasons if s["year"] in cluster_years]
                        debut = min(cluster_years)
                        sub_clusters.append((debut, cluster_seasons))

                    if len(sub_clusters) == 1:
                        hist_player_seasons[label] = sub_clusters[0][1]
                        hist_player_positions[label] = primary_pg
                    else:
                        for k, (debut, cs) in enumerate(sub_clusters):
                            sub_label = f"{label.split(' (')[0]} ({debut})" if "(" in label else f"{label} ({debut})"
                            hist_player_seasons[sub_label] = cs
                            hist_player_positions[sub_label] = primary_pg
        else:
            # No position conflicts — use gap-based splitting with position awareness
            seasons = [{"team": e["team"], "year": e["year"]} for e in entries]
            years_sorted = sorted(set(s["year"] for s in seasons))
            # Determine primary position
            pos_counts = defaultdict(int)
            for e in entries:
                if e["position"]:
                    pos_counts[e["position"]] += 1
            primary_pos = max(pos_counts, key=pos_counts.get) if pos_counts else ""

            # Build year → dominant position group mapping for position-aware gap detection
            year_pg = {}
            for e in entries:
                pg = POS_GROUPS.get(e.get("position", ""), "")
                if pg:
                    year_pg.setdefault(e["year"], defaultdict(int))
                    year_pg[e["year"]][pg] += 1
            year_primary_pg = {}
            for yr, counts in year_pg.items():
                year_primary_pg[yr] = max(counts, key=counts.get)

            split_points = []
            for i in range(1, len(years_sorted)):
                gap = years_sorted[i] - years_sorted[i - 1]
                # Standard gap threshold
                if gap > 5:
                    split_points.append(i)
                # Lower threshold when position group changes across the gap
                elif gap >= 3:
                    pg_before = year_primary_pg.get(years_sorted[i - 1], "")
                    pg_after = year_primary_pg.get(years_sorted[i], "")
                    if pg_before and pg_after and pg_before != pg_after:
                        split_points.append(i)

            if not split_points:
                hist_player_seasons[name] = seasons
                if primary_pos:
                    hist_player_positions[name] = primary_pos
            else:
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
                    if primary_pos:
                        hist_player_positions[label] = primary_pos

    print(f"   Position-aware splitting created {pos_split_count} entries from same-name players")

    # Helper: extract base name from a disambiguated label
    def base_name(label):
        if label.endswith(" Sr.") or label.endswith(" Jr."):
            return label[:-4]
        if " (" in label and label.endswith(")"):
            return label[:label.rindex(" (")]
        return label

    # Merge historical into modern, tracking renames so we can update teamSeasons
    modern_renames = {}  # old_name → new_name for players renamed during merge
    for name, seasons in list(hist_player_seasons.items()):
        hist_years = set(s["year"] for s in seasons)
        hist_pos = hist_player_positions.get(name, "")
        hist_pg = POS_GROUPS.get(hist_pos, hist_pos)
        bname = base_name(name)

        # Try exact name match first, then base name match for disambiguated entries
        modern_match = None
        if name in nfl_player_seasons:
            modern_match = name
        elif bname != name and bname in nfl_player_seasons:
            modern_match = bname

        if modern_match:
            modern_years = set(s["year"] for s in nfl_player_seasons[modern_match])
            # Compute gap regardless of which set comes first
            if modern_years and hist_years:
                gap = max(min(modern_years) - max(hist_years),
                          min(hist_years) - max(modern_years))
            else:
                gap = 999

            # Check both modern and historical position dicts (hist entries added earlier
            # in this loop won't have nfl_player_positions set yet)
            modern_pos = nfl_player_positions.get(modern_match, "") or hist_player_positions.get(modern_match, "")
            modern_pg = POS_GROUPS.get(modern_pos, modern_pos)
            pos_compatible = (not hist_pg or not modern_pg or hist_pg == modern_pg)

            # Never merge entries that were already disambiguated (Jr./Sr./year suffix)
            already_disambiguated = (bname != name)

            if gap <= 5 and pos_compatible and not already_disambiguated:
                # Same player spanning eras — merge, using the modern name
                nfl_player_seasons[modern_match] = seasons + nfl_player_seasons[modern_match]
            else:
                # Different player — disambiguate
                hist_debut = min(hist_years)
                modern_debut = min(modern_years)
                # Use original historical label if already disambiguated
                if bname != name:
                    hist_label = name
                elif f"{name} Sr." not in nfl_player_seasons and hist_debut + 15 <= modern_debut:
                    hist_label = f"{name} Sr."
                    modern_label = f"{name} Jr."
                    nfl_player_seasons[modern_label] = nfl_player_seasons.pop(modern_match)
                    if modern_match in nfl_player_positions:
                        nfl_player_positions[modern_label] = nfl_player_positions.pop(modern_match)
                    modern_renames[modern_match] = modern_label
                else:
                    hist_label = f"{name} ({hist_debut})" if bname == name else name
                    modern_label = f"{modern_match} ({modern_debut})"
                    nfl_player_seasons[modern_label] = nfl_player_seasons.pop(modern_match)
                    if modern_match in nfl_player_positions:
                        nfl_player_positions[modern_label] = nfl_player_positions.pop(modern_match)
                    modern_renames[modern_match] = modern_label
                # Add historical entry
                nfl_player_seasons[hist_label] = seasons
                if name in hist_player_positions:
                    nfl_player_positions[hist_label] = hist_player_positions[name]
        else:
            nfl_player_seasons[name] = seasons
            if name in hist_player_positions:
                nfl_player_positions[name] = hist_player_positions[name]

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

# === NFL: Well-known player determination (career length by position) ===
NFL_WELL_KNOWN_YEARS = {
    "QB": 8, "RB": 8, "FB": 8, "WR": 8, "TE": 7,
    "LB": 7, "ILB": 7, "OLB": 7, "MLB": 7,
    "DB": 7, "CB": 7, "S": 7, "SS": 7, "FS": 7,
    "OL": 6, "OT": 6, "OG": 6, "C": 6, "T": 6, "G": 6,
    "DL": 6, "DE": 6, "DT": 6, "NT": 6,
    "K": 10, "P": 10, "SPEC": 10, "LS": 10,
}
nfl_well_known = {}
for name, seasons in nfl_player_seasons.items():
    career_years = len(set(s["year"] for s in seasons))
    pos = nfl_player_positions.get(name, "")
    threshold = NFL_WELL_KNOWN_YEARS.get(pos, 7)
    if career_years >= threshold:
        nfl_well_known[name] = True
nfl_well_known_list = sorted(nfl_well_known.keys())
print(f"   {len(nfl_well_known_list):,} NFL players marked as well-known")

nfl_data = {
    "players": sorted(nfl_player_seasons.keys()),
    "playerSeasons": nfl_player_seasons,
    "teamSeasons": nfl_team_seasons,
    "playerPositions": nfl_player_positions,
    "wellKnown": nfl_well_known_list,
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
