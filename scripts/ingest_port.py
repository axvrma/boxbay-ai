"""Refresh credited public monthly series from official yearly tables or saved HTML."""
import argparse
import calendar
import csv
from pathlib import Path
from urllib.request import Request, urlopen

from bs4 import BeautifulSoup

SOURCE = "https://portoflosangeles.org/business/statistics/container-statistics/historical-teu-statistics-"


def extract(html: bytes, year: int):
    months = {m: i for i, m in enumerate(calendar.month_name) if m}
    rows = {}
    for tr in BeautifulSoup(html, "html.parser").find_all("tr"):
        cells = [x.get_text(strip=True) for x in tr.find_all(["th", "td"])]
        if len(cells) >= 7 and cells[0].split() and (month := months.get(cells[0].split()[0])):
            rows[month] = (f"{year}-{month:02}", *(float(cells[i].replace(",", "")) for i in (1, 2, 4, 5)))
    if len(rows) != 12:
        raise ValueError(f"{year}: expected 12 monthly rows, got {len(rows)}")
    return [rows[i] for i in range(1, 13)]


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--html-dir", type=Path, help="Directory containing official YYYY.html exports")
    parser.add_argument("--output", type=Path, default=Path("data/sources/pola-monthly-v1.csv"))
    args = parser.parse_args()
    result = []
    for year in range(2010, 2026):
        if args.html_dir:
            raw = (args.html_dir / f"{year}.html").read_bytes()
        else:
            with urlopen(Request(SOURCE + str(year), headers={"User-Agent": "BOXBAY AI research"}), timeout=30) as reply:
                raw = reply.read()
        result.extend(extract(raw, year))
    with args.output.open("w", newline="") as file:
        writer = csv.writer(file, lineterminator="\n")
        writer.writerow(("month", "loaded_import_teu", "empty_import_teu", "loaded_export_teu", "empty_export_teu"))
        writer.writerows((r[0], *(f"{v:.2f}" for v in r[1:])) for r in result)
