import json
from pathlib import Path
import pandas as pd

# ====================== MLB (Lahman Database - full history 1871-2025) ======================
# 1. Download latest ZIP from https://sabr.org/lahman-database/ (Version 2025 released Jan 2026)
# 2. Extract to ./lahman/ (or change path below)

lahman_dir = Path("./lahman")
if not lahman_dir.exists():
    raise FileNotFoundError("Extract Lahman ZIP to ./lahman/ first")

people = pd.read_csv(lahman_dir / "people.csv", usecols=["playerID", "nameFirst", "nameLast"])
people["fullName"] = (people["nameFirst"].fillna("") + " " + people["nameLast"].fillna("")).str.strip()

appearances = pd.read_csv(lahman_dir / "appearances.csv", usecols=["playerID", "yearID", "teamID"])
appearances = appearances.merge(people[["playerID", "fullName"]], on="playerID")
appearances = appearances.dropna(subset=["fullName", "yearID", "teamID"])

# Player → list of seasons
mlb_player_seasons: dict = {}
for name, group in appearances.groupby("fullName"):
    mlb_player_seasons[name] = [
        {"team": row["teamID"], "year": int(row["yearID"])}
        for _, row in group.iterrows()
    ]

# Team-year → list of players (for fast neighbor lookup)
mlb_team_seasons: dict = {}
for (team, year), group in appearances.groupby(["teamID", "yearID"]):
    key = f"{team}-{int(year)}"
    mlb_team_seasons[key] = group["fullName"].unique().tolist()

mlb_data = {
    "players": sorted(mlb_player_seasons.keys()),
    "playerSeasons": mlb_player_seasons,
    "teamSeasons": mlb_team_seasons
}

# ====================== NFL (nfl_data_py - 1999-present) ======================
# pip install nfl_data_py pandas

import nfl_data_py as nfl

years = list(range(1999, 2026))  # update as new seasons drop
rosters = nfl.import_seasonal_rosters(years)

rosters["fullName"] = rosters["full_name"].str.strip()

nfl_player_seasons: dict = {}
for name, group in rosters.groupby("fullName"):
    nfl_player_seasons[name] = [
        {"team": row["team"], "year": int(row["season"])}
        for _, row in group.iterrows()
    ]

nfl_team_seasons: dict = {}
for (team, year), group in rosters.groupby(["team", "season"]):
    key = f"{team}-{int(year)}"
    nfl_team_seasons[key] = group["fullName"].drop_duplicates().tolist()

nfl_data = {
    "players": sorted(nfl_player_seasons.keys()),
    "playerSeasons": nfl_player_seasons,
    "teamSeasons": nfl_team_seasons
}

# ====================== Save ======================
data_dir = Path("src/data")
data_dir.mkdir(parents=True, exist_ok=True)

with open(data_dir / "mlb_data.json", "w", encoding="utf-8") as f:
    json.dump(mlb_data, f, separators=(",", ":"))  # compact

with open(data_dir / "nfl_data.json", "w", encoding="utf-8") as f:
    json.dump(nfl_data, f, separators=(",", ":"))

print(f"✅ Done! MLB players: {len(mlb_data['players']):,}")
print(f"✅ Done! NFL players: {len(nfl_data['players']):,}")
print("Files written to src/data/*.json — commit them!")
