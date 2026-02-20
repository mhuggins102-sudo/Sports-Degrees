import json
from pathlib import Path
import pandas as pd

print("🔄 Building offline MLB + NFL data...")

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

people = pd.read_csv(people_file, usecols=["playerID", "nameFirst", "nameLast"], dtype=str)
people["fullName"] = (people["nameFirst"].fillna("") + " " + people["nameLast"].fillna("")).str.strip()
people = people[people["fullName"].str.len() > 3]

appearances = pd.read_csv(appearances_file, usecols=["playerID", "yearID", "teamID"])
df = appearances.merge(people[["playerID", "fullName"]], on="playerID")
df = df.dropna(subset=["fullName", "yearID", "teamID"]).copy()

mlb_player_seasons = {}
for name, group in df.groupby("fullName"):
    mlb_player_seasons[name] = [
        {"team": str(row["teamID"]), "year": int(row["yearID"])}
        for _, row in group.iterrows()
    ]

mlb_team_seasons = {}
for (team, year), group in df.groupby(["teamID", "yearID"]):
    key = f"{team}-{int(year)}"
    mlb_team_seasons[key] = sorted(set(group["fullName"].tolist()))

mlb_data = {
    "players": sorted(mlb_player_seasons.keys()),
    "playerSeasons": mlb_player_seasons,
    "teamSeasons": mlb_team_seasons
}

# === NFL (unchanged) ===
import nfl_data_py as nfl
print("✅ Processing NFL data...")
years = list(range(1999, 2026))
rosters = nfl.import_seasonal_rosters(years)
rosters["fullName"] = rosters["full_name"].fillna("").str.strip()

nfl_player_seasons = {}
for name, group in rosters.groupby("fullName"):
    if len(name.strip()) < 4: continue
    nfl_player_seasons[name] = [
        {"team": str(row["team"]), "year": int(row["season"])}
        for _, row in group.iterrows()
    ]

nfl_team_seasons = {}
for (team, year), group in rosters.groupby(["team", "season"]):
    key = f"{team}-{int(year)}"
    nfl_team_seasons[key] = sorted(set(group["fullName"].dropna().tolist()))

nfl_data = {
    "players": sorted(nfl_player_seasons.keys()),
    "playerSeasons": nfl_player_seasons,
    "teamSeasons": nfl_team_seasons
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
