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

# === NFL: Import Pro Bowl / All-Pro / HOF honors from draft picks data ===
print("   Loading NFL player honors (Pro Bowl / All-Pro / HOF)...")
honors_by_gsis = {}   # gsis_id → {probowls, allpro, hof}
honors_by_name = {}   # pfr_player_name → {probowls, allpro, hof}
try:
    draft_picks_df = nfl.import_draft_picks()
    for _, row in draft_picks_df.iterrows():
        pb = int(row["probowls"]) if pd.notna(row.get("probowls")) else 0
        ap = int(row["allpro"]) if pd.notna(row.get("allpro")) else 0
        hof = bool(row.get("hof")) if pd.notna(row.get("hof")) else False

        # Index by gsis_id (matches player_id in modern rosters)
        gsis = row.get("gsis_id")
        if pd.notna(gsis) and gsis:
            existing = honors_by_gsis.get(gsis, {"probowls": 0, "allpro": 0, "hof": False})
            honors_by_gsis[gsis] = {
                "probowls": max(pb, existing["probowls"]),
                "allpro": max(ap, existing["allpro"]),
                "hof": hof or existing["hof"],
            }

        # Index by name (for historical players without gsis_id)
        name = row.get("pfr_player_name", "")
        if pd.notna(name) and name:
            existing = honors_by_name.get(name, {"probowls": 0, "allpro": 0, "hof": False})
            honors_by_name[name] = {
                "probowls": max(pb, existing["probowls"]),
                "allpro": max(ap, existing["allpro"]),
                "hof": hof or existing["hof"],
            }
    has_any = sum(1 for h in honors_by_gsis.values() if h["probowls"] >= 1 or h["allpro"] >= 1 or h["hof"])
    print(f"   Loaded honors for {len(honors_by_gsis):,} players by ID, {len(honors_by_name):,} by name ({has_any:,} with honors)")
except Exception as e:
    print(f"   Warning: Could not load draft picks honors: {e}")

# Build reverse map: display_name → player_id for modern players
nfl_name_to_pid = {v: k for k, v in nfl_modern_id_to_name.items()}

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

# === NFL: Well-known player determination (honors + career length) ===
# Tier 1: Any Pro Bowl, All-Pro, or HOF player is well-known
# Tier 2: Long career by position (raised thresholds as fallback)
NFL_WELL_KNOWN_YEARS = {
    "QB": 10, "RB": 10, "FB": 10, "WR": 10, "TE": 9,
    "LB": 9, "ILB": 9, "OLB": 9, "MLB": 9,
    "DB": 9, "CB": 9, "S": 9, "SS": 9, "FS": 9,
    "OL": 8, "OT": 8, "OG": 8, "C": 8, "T": 8, "G": 8,
    "DL": 8, "DE": 8, "DT": 8, "NT": 8,
    "K": 12, "P": 12, "SPEC": 12, "LS": 12,
}

def _has_honors(name):
    """Check if a player has Pro Bowl, All-Pro, or HOF honors."""
    # Check by player_id (modern players, 1999+)
    pid = nfl_name_to_pid.get(name)
    if pid and pid in honors_by_gsis:
        h = honors_by_gsis[pid]
        if h["probowls"] >= 1 or h["allpro"] >= 1 or h["hof"]:
            return True
    # Check by name match (historical/drafted players)
    # Strip disambiguation suffix: "John Smith (1990)" → "John Smith", "John Smith Jr." → "John Smith"
    base = name
    if " (" in base and base.endswith(")"):
        base = base[:base.rindex(" (")]
    for suffix in (" Sr.", " Jr."):
        if base.endswith(suffix):
            base = base[:-len(suffix)]
    for candidate in [name, base]:
        if candidate in honors_by_name:
            h = honors_by_name[candidate]
            if h["probowls"] >= 1 or h["allpro"] >= 1 or h["hof"]:
                return True
    return False

nfl_well_known = {}
honors_count = 0
career_count = 0
for name, seasons in nfl_player_seasons.items():
    has_honor = _has_honors(name)
    career_years = len(set(s["year"] for s in seasons))
    pos = nfl_player_positions.get(name, "")
    threshold = NFL_WELL_KNOWN_YEARS.get(pos, 9)
    long_career = career_years >= threshold

    if has_honor:
        nfl_well_known[name] = True
        honors_count += 1
    elif long_career:
        nfl_well_known[name] = True
        career_count += 1

nfl_well_known_list = sorted(nfl_well_known.keys())
print(f"   {len(nfl_well_known_list):,} NFL players marked as well-known ({honors_count:,} by honors, {career_count:,} by career length)")

# === NFL: Pre-compute challenge pairs per difficulty ===
from collections import deque
import random

print("   Pre-computing NFL challenge pairs...")

def bfs_distance(start, target, max_depth):
    """BFS returning distance or None. Uses deque for O(1) popleft."""
    if start == target:
        return 0
    queue = deque([(start, 0)])
    visited = {start}
    while queue:
        current, depth = queue.popleft()
        if depth >= max_depth:
            continue
        for s in nfl_player_seasons.get(current, []):
            key = f"{s['team']}-{s['year']}"
            for p in nfl_team_seasons.get(key, []):
                if p in visited:
                    continue
                if p == target:
                    return depth + 1
                visited.add(p)
                queue.append((p, depth + 1))
    return None

# Build eligible endpoints (same logic as TypeScript buildEndpointEligible)
NFL_POS_BONUS = {"QB": 3, "RB": 2, "FB": 2, "WR": 2, "TE": 1, "LB": 1, "ILB": 1, "OLB": 1, "MLB": 1, "CB": 1}

def compute_fame(name):
    seasons = nfl_player_seasons.get(name, [])
    career = len(set(s["year"] for s in seasons))
    pos = nfl_player_positions.get(name, "")
    pos_bonus = NFL_POS_BONUS.get(pos, 0)
    teammates = set()
    for s in seasons:
        key = f"{s['team']}-{s['year']}"
        for p in nfl_team_seasons.get(key, []):
            if p != name:
                teammates.add(p)
    tm_bonus = min(3, len(teammates) // 50)
    return career + pos_bonus + tm_bonus

nfl_eligible_all = [p for p in nfl_player_seasons if p in nfl_well_known and compute_fame(p) >= 15]
print(f"   {len(nfl_eligible_all):,} eligible NFL endpoints (all positions)")

# Position-filtered pools per difficulty:
# Easy: QB, RB, WR only (skill positions casual fans know)
# Medium: + TE, K, CB, LB, S, SS, FS, ILB, OLB, MLB
# Hard: any position
EASY_POSITIONS = {"QB", "RB", "WR"}
MEDIUM_POSITIONS = {"QB", "RB", "WR", "TE", "K", "CB", "LB", "S", "SS", "FS", "ILB", "OLB", "MLB"}

nfl_eligible_easy = [p for p in nfl_eligible_all if nfl_player_positions.get(p, "") in EASY_POSITIONS]
nfl_eligible_medium = [p for p in nfl_eligible_all if nfl_player_positions.get(p, "") in MEDIUM_POSITIONS]
nfl_eligible_hard = nfl_eligible_all

print(f"   Easy pool: {len(nfl_eligible_easy):,} (QB/RB/WR)")
print(f"   Medium pool: {len(nfl_eligible_medium):,} (+ TE/K/CB/LB/S)")
print(f"   Hard pool: {len(nfl_eligible_hard):,} (all positions)")

random.seed(42)  # reproducible builds

DIFFICULTY_CONFIG = {
    "Easy":   {"range": (2, 3), "pool": nfl_eligible_easy},
    "Medium": {"range": (3, 5), "pool": nfl_eligible_medium},
    "Hard":   {"range": (4, 7), "pool": nfl_eligible_hard},
}
PAIRS_PER_DIFFICULTY = 200

nfl_challenge_pairs = {}
for diff, cfg in DIFFICULTY_CONFIG.items():
    min_deg, max_deg = cfg["range"]
    pool = cfg["pool"]
    pairs = []
    attempts = 0
    max_attempts = 5000
    if len(pool) < 2:
        print(f"   {diff}: pool too small ({len(pool)}), skipping")
        nfl_challenge_pairs[diff] = []
        continue
    while len(pairs) < PAIRS_PER_DIFFICULTY and attempts < max_attempts:
        attempts += 1
        i1 = random.randrange(len(pool))
        i2 = random.randrange(len(pool))
        if i1 == i2:
            continue
        p1, p2 = pool[i1], pool[i2]
        dist = bfs_distance(p1, p2, max_deg)
        if dist is not None and min_deg <= dist <= max_deg:
            pairs.append([p1, p2, dist])
    nfl_challenge_pairs[diff] = pairs
    print(f"   {diff}: {len(pairs)} pairs found in {attempts} attempts")

nfl_data = {
    "players": sorted(nfl_player_seasons.keys()),
    "playerSeasons": nfl_player_seasons,
    "teamSeasons": nfl_team_seasons,
    "playerPositions": nfl_player_positions,
    "wellKnown": nfl_well_known_list,
    "challengePairs": nfl_challenge_pairs,
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
