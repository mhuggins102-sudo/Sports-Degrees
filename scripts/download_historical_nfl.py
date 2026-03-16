"""
Download historical NFL roster data (1966-1998) from nflverse-data GitHub releases.
Outputs a single CSV: scripts/historical_nfl_rosters.csv

This only needs to be run once. The output CSV is committed to the repo.
"""

import csv
import io
import time
import urllib.request
from pathlib import Path

BASE_URL = "https://github.com/nflverse/nflverse-data/releases/download/rosters/roster_{year}.csv"
YEARS = range(1966, 1999)  # 1966-1998 inclusive
OUTPUT = Path(__file__).parent / "historical_nfl_rosters.csv"

# Normalize historical team abbreviations to match nfl_data_py conventions
# where franchises used different codes across eras
TEAM_MAP = {
    "BOS": "NE",      # Boston Patriots → New England Patriots
    "RAI": "OAK",     # LA Raiders → use OAK (nfl_data_py uses OAK for Oakland era, LV for Vegas)
    "RAM": "LA",      # LA Rams (nfl_data_py uses LA for Rams in LA)
    "PHO": "ARI",     # Phoenix Cardinals → Arizona Cardinals
}


def download_year(year):
    url = BASE_URL.format(year=year)
    req = urllib.request.Request(url, headers={"User-Agent": "Sports-Degrees-DataBuilder/1.0"})
    resp = urllib.request.urlopen(req, timeout=30)
    return resp.read().decode("utf-8")


def main():
    all_rows = []
    for year in YEARS:
        print(f"Downloading {year}...", end=" ", flush=True)
        try:
            raw = download_year(year)
            reader = csv.DictReader(io.StringIO(raw))
            count = 0
            for row in reader:
                name = row.get("full_name", "").strip()
                team = row.get("team", "").strip()
                position = row.get("position", "").strip()
                if not name or len(name) < 4 or not team:
                    continue
                # Normalize team abbreviation
                team = TEAM_MAP.get(team, team)
                all_rows.append({
                    "player_name": name,
                    "team": team,
                    "season": year,
                    "position": position,
                })
                count += 1
            print(f"{count} players")
        except Exception as e:
            print(f"FAILED: {e}")
        time.sleep(1)  # Be respectful to GitHub

    # Write output
    with open(OUTPUT, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["player_name", "team", "season", "position"])
        writer.writeheader()
        writer.writerows(all_rows)

    print(f"\nDone! {len(all_rows):,} total player-season records → {OUTPUT}")


if __name__ == "__main__":
    main()
