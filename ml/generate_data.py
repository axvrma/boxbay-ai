"""Generate synthetic Jebel Ali data and independently reproducible input fixtures."""
from __future__ import annotations

import argparse
import csv
import hashlib
import heapq
import json
import random
from collections import Counter
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "apps/web/public"
DATA = ROOT / "data/synthetic"
SEED = 240319
START = date(2021, 1, 1)
END = date(2026, 1, 1)
GST = timezone(timedelta(hours=4))
COMMODITIES = ("Electronics", "Textiles", "Pharmaceuticals", "Automotive parts", "Retail merchandise",
               "Industrial machinery", "Refrigerated food", "General cargo", "Construction materials", "Chemicals")
RECEIVERS = ("Gulf Retail Distribution", "Dubai Electronics Trading", "Emirates Automotive Supply",
             "JAFZA Industrial Logistics", "Arabian Cold Chain", "GCC Consumer Goods", "Gulf Construction Supply",
             "Desert Tech Distribution", "Regional Pharma Logistics", "Meridian General Trading",
             "Peninsula Freight Services", "Oasis Storage Solutions")
PORTS = ("Shenzhen", "Nhava Sheva", "Rotterdam", "Busan", "Shanghai", "Hamburg", "Mundra",
         "Singapore", "Ningbo", "Jebel Ali", "Jebel Ali", "Jebel Ali")
REGIONS = ("East Asia", "South Asia", "Europe", "East Asia", "East Asia", "Europe", "South Asia",
           "Southeast Asia", "East Asia", "Gulf", "Gulf", "UAE")
DESTINATIONS = ("Jebel Ali", "Jebel Ali", "Jebel Ali", "Jebel Ali", "Jebel Ali", "Jebel Ali",
                "Jebel Ali", "Jebel Ali", "Jebel Ali", "Dammam", "Doha", "Regional distribution centre")
EVENTS = ("Normal operations", "Ramadan", "Eid al-Fitr", "Eid al-Adha", "Dubai Shopping Festival", "Diwali",
          "Year-end retail", "Lunar New Year", "Summer conditions", "UAE holiday", "Peak shipping")
SCENARIOS = [
    ("normal", "Normal operations", .65, .12, .94, .32, 2),
    ("surge", "Vessel arrival surge", .78, .42, .82, .88, 2),
    ("delayed", "Delayed vessel", .62, .29, .91, .61, 2),
    ("unexpected", "Unexpected vessel arrival", .76, .47, .88, .92, 2),
    ("full", "High terminal occupancy", .94, .48, .83, .51, 2),
    ("trucks", "Truck pickup congestion", .80, .86, .48, .50, 2),
    ("reduced", "Reduced crane availability", .71, .44, .83, .52, 1),
    ("breakdown", "Crane breakdown", .82, .67, .73, .59, 1),
]
PROFILE = [(round(2.6 + (i * 7 % 13) * .37, 2), round(.62 + (i * 11 % 16) * .022, 3))
           for i in range(len(RECEIVERS))]
VESSELS = ["Gulf Lantern", "Crescent Meridian", "Sandstone Trader", "Arabian Juniper", "Pearl Horizon", "Dune Voyager"]


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n")


def calendar():
    # Scenario anchors are illustrative approximations. No holiday announcement is implied.
    movable = {
        2021: ("04-13", "05-13", "07-20", "11-04", "02-12"),
        2022: ("04-02", "05-02", "07-09", "10-24", "02-01"),
        2023: ("03-23", "04-21", "06-28", "11-12", "01-22"),
        2024: ("03-11", "04-10", "06-16", "11-01", "02-10"),
        2025: ("03-01", "03-30", "06-06", "10-20", "01-29"),
        2026: ("02-18", "03-20", "05-27", "11-08", "02-17"),
        2027: ("02-08", "03-10", "05-17", "10-29", "02-06"),
        2028: ("01-28", "02-27", "05-05", "10-17", "01-26"),
    }
    rows = []
    for year, anchors in movable.items():
        windows = [(2, anchors[1], 5, 5, 1), (3, anchors[2], 5, 5, 1), (9, "12-02", 1, 2, 1),
                   (5, anchors[3], 14, 4, 1), (7, anchors[4], 17, 10, 1), (6, "12-24", 18, 6, 1),
                   (1, anchors[0], 3, 1, 29), (4, "12-15", 4, 6, 29), (10, "09-15", 0, 4, 55),
                   (8, "07-01", 0, 0, 65)]
        for kind, anchor, before, after, duration in windows:
            rows.append(dict(kind=kind, date=f"{year}-{anchor}", before=before, after=after, duration=duration))
    return rows


def event_for(day, windows):
    active = []
    for item, anchor in windows:
        gap = (day - anchor).days
        if -item["before"] <= gap < item["duration"] + item["after"]:
            active.append((item["kind"] in (1, 4, 8, 10), max(0, -gap, gap - item["duration"] + 1),
                           abs(gap), item["kind"], gap))
    if not active:
        return 0, 31, 31
    _, _, _, kind, gap = min(active)
    return kind, min(31, max(0, -gap)), min(31, max(0, gap))


def cargo_for(i, rng):
    commodity = i % len(COMMODITIES)
    lane = i % len(PORTS)
    size = 20 if i in (1, 6) or (i >= 8 and rng.random() < .31) else 40
    kind = "reefer" if commodity in (2, 6) else "hazard" if commodity == 9 else "dry"
    weight = ([24000, 18000, 21000, 27000, 22000, 29000, 19000, 25000][i] if i < 8 else
              round(min(28000 if size == 20 else 33000, max(9000, rng.gauss(17000 if size == 20 else 23500, 3300)))))
    return dict(commodity=commodity, lane=lane, receiver=[1, 5, 8, 2, 0, 3, 4, 9, 6, 10, 7, 11][i % 12],
                size=size, kg=weight, kind=kind, priority=2 if i in (2, 6, 12) else 1 if i % 5 == 0 else 0,
                customs=1 if i % 11 == 5 else 0, vessel=i % len(VESSELS))


def demo(events):
    rng = random.Random(SEED)
    cells = []
    for rack, z in (("A", -4.5), ("B", 4.5)):
        for bay in range(1, 9):
            for level in range(1, 5):
                cells.append(dict(id=f"{rack}{bay:02}-{level}", rack=rack, bay=bay, level=level,
                                  x=round(4.5 + (bay - 0.5) * 13.4, 2), y=level * 3.4, z=z, maxKg=30000 if level == 4 else 36000,
                                  sizes=[20] if bay == 7 and level in (3, 4) else [20, 40], reefer=bay in (2, 3),
                                  hazard=bay == 8, blocked=(rack == "B" and bay == 6 and level == 4),
                                  reserved=bay == 1 and level == 1))
    incoming = [dict(cargo_for(i, rng), id=f"JA-DEMO-{i+1:03}") for i in range(36)]
    eligible = [cell for cell in cells if not cell["blocked"] and not cell["reserved"]]
    rng.shuffle(eligible)
    initial = []
    for i, cell in enumerate(eligible[:45]):
        item = cargo_for(i + 7, rng)
        if item["kind"] == "hazard" and not cell["hazard"] or item["kind"] == "reefer" and not cell["reefer"]:
            item.update(kind="dry", commodity=7)
        if cell["hazard"]:
            item.update(kind="hazard", commodity=9)
        item.update(id=f"JA-YARD-{i+1:03}", size=20 if cell["sizes"] == [20] else item["size"],
                    kg=min(item["kg"], cell["maxKg"], 28000 if cell["sizes"] == [20] else 36000))
        initial.append(dict(cargo=item, slot=cell["id"], ageDays=round(rng.uniform(.25, 6.5), 2),
                            actualDwellDays=round(rng.uniform(7.5, 12.5), 2), arrivalScenario=("trucks", "normal", "surge")[i % 3]))
    return dict(
        schema=1, defaultDate="2025-12-19", dateMin="2021-01-01", dateMax="2028-12-31",
        cells=cells, incoming=incoming, initial=initial, events=events, eventNames=EVENTS,
        commodities=COMMODITIES, ports=PORTS, regions=REGIONS, destinations=DESTINATIONS,
        receivers=[dict(id=f"RX-{i+1:02}", name=name, dwell=PROFILE[i][0], reliability=PROFILE[i][1])
                   for i, name in enumerate(RECEIVERS)],
        vessels=[dict(id=f"VS-{i+1:02}", name=name, lane=i, scheduledDay=i % 3 + 1, containers=8+i*3)
                 for i, name in enumerate(VESSELS)],
        scenarios=[dict(id=s[0], name=s[1], occupancy=s[2], congestion=s[3], truck=s[4],
                        vessel=s[5], cranes=s[6]) for s in SCENARIOS],
        rates=dict(electricity=.35, equipment=4, time=65, emissions=.40, usd=.2723),
    )


def generate(size, seed):
    if size < 1000:
        raise ValueError("Use at least 1,000 observations for temporal cohorts.")
    rng = random.Random(seed)
    events = calendar()
    windows = [(event, date.fromisoformat(event["date"])) for event in events]
    days = []
    for offset in range((END - START).days):
        when = START + timedelta(days=offset)
        event, until, since = event_for(when, windows)
        vessel = rng.uniform(.1, .9)
        congestion = min(.99, max(0, rng.gauss(.25 + .25 * vessel, .18)))
        occupancy = min(.98, max(.2, rng.gauss(.56 + .22 * vessel, .12)))
        truck = min(1, max(.25, rng.gauss(.93 - .25 * congestion - .10 * (event in (1, 2, 3)), .09)))
        crane = .5 if rng.random() < .11 else 1
        arrivals = max(2, round(8 + 27 * vessel + 7 * (event in (4, 5, 6, 10)) + rng.gauss(0, 5)))
        pickups = max(1, round(5 + 24 * truck + 7 * occupancy - 7 * congestion + rng.gauss(0, 5)))
        days.append(dict(date=when.isoformat(), event=event, daysTo=until, daysSince=since, vessel=vessel,
                         occupancy=occupancy, congestion=congestion, truck=truck, crane=crane,
                         arrivals=arrivals, pickups=pickups))
    # Count training records by day, but keep arrival timestamps ordered within each day.
    counts = Counter(rng.choices(range(len(days)), weights=[d["arrivals"] for d in days], k=size))
    history = [[] for _ in range(12)]
    sums, successful, completed = [0.] * 12, [0] * 12, [0] * 12
    sample = []
    manifest = dict(schema=1, seed=seed, containers=size, dailyRecords=len(days),
                    start=START.isoformat(), end=(END - timedelta(days=1)).isoformat(), source="synthetic",
                    timezone="Asia/Dubai", calendar="Illustrative regional scenario windows")
    DATA.mkdir(parents=True, exist_ok=True)
    with (DATA / "daily-demand.csv").open("w", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(days[0]))
        writer.writeheader()
        writer.writerows(days)
    with (DATA / "containers.csv").open("w", newline="") as stream:
        writer = None
        identifier = 0
        distribution = Counter()
        for day_index, daily in enumerate(days):
            when = START + timedelta(days=day_index)
            count = counts[day_index]
            day_start = datetime.combine(when, datetime.min.time(), GST)
            for second in sorted(rng.randrange(86400) for _ in range(count)):
                identifier += 1
                ts = day_start + timedelta(seconds=second)
                commodity = rng.choices(range(10), weights=[20, 9, 5, 14, 19, 9, 10, 12, 7, 4])[0]
                lanes = [(0, 4, 8, 7), (1, 6, 7), (2, 5, 7), (3, 4, 5), (4, 0, 8, 6),
                         (5, 2, 3), (6, 7, 2), (7, 1, 9, 10, 11), (8, 6, 5, 11), (9, 1, 5, 10)]
                lane = rng.choice(lanes[commodity]) if rng.random() < .84 else rng.randrange(len(PORTS))
                receiver = (rng.randrange(10, 12) if when.year == 2025 and rng.random() < .16 else
                            (commodity * 7 + rng.choices([0, 1, 2, 3], [6, 2, 1, 1])[0]) % 10)
                prior, reliability = PROFILE[receiver] if receiver < 10 else (4.6, .77)
                queue = history[receiver]
                while queue and queue[0][0] < ts.timestamp():
                    _, old_dwell, on_time = heapq.heappop(queue)
                    sums[receiver] += old_dwell
                    completed[receiver] += 1
                    successful[receiver] += on_time
                dwell_history = (sums[receiver] + 42 * prior) / (completed[receiver] + 42)
                pickup_reliability = (successful[receiver] + 42 * reliability) / (completed[receiver] + 42)
                size_ft = 20 if rng.random() < .32 else 40
                weight = int(min(28000 if size_ft == 20 else 33000, max(7000, rng.gauss(16700 if size_ft == 20 else 23400, 3800))))
                kind = "reefer" if commodity in (2, 6) else "hazard" if commodity == 9 else "dry"
                priority = rng.choices([0, 1, 2], [72, 22, 6])[0]
                customs = int(rng.random() < (.13 + .09 * (lane in (2, 5))))
                event = daily["event"]
                seasonal = (-1.55 if event in (4, 5, 6) and commodity in (0, 1, 4) else
                            1.35 if event == 7 and lane in (0, 4, 8) else
                            1.2 if event in (1, 2, 3) and priority == 0 else
                            -.65 if event in (1, 2, 3) else .65 if event == 8 and kind == "reefer" else 0)
                congestion = daily["congestion"]
                center = (.67 * prior + .72 * customs + seasonal + 2.2 * congestion + 1.55 * (1 - daily["truck"])
                          + .48 * daily["vessel"] + 1.1 * (daily["occupancy"] - .55) + .85 * (1 - daily["crane"])
                          - .64 * priority + .64 * (kind == "hazard") + .37 * (weight / 23000 - 1)
                          + .42 * (when.weekday() >= 5))
                dwell = round(max(.25, center + rng.gauss(0, .84) + (rng.expovariate(.65) if rng.random() < .10 else 0)), 4)
                departure = ts + timedelta(days=dwell)
                heapq.heappush(queue, (departure.timestamp(), dwell, int(dwell <= prior + 1.5)))
                row = dict(containerId=f"JA-SYN-{identifier:06}", vesselId=f"VS-{day_index % len(VESSELS) + 1:02}",
                           receiverId=receiver, originPort=PORTS[lane], destinationPort=DESTINATIONS[lane], tradeLane=lane,
                           arrivalTimestamp=ts.isoformat(), departureTimestamp=departure.isoformat(), commodity=commodity,
                           sizeFt=size_ft, grossWeightKg=weight, containerType=kind, priority=priority, customsStatusAtArrival=customs,
                           receiverHistoricalDwellDays=dwell_history, receiverPickupReliability=pickup_reliability,
                           seasonalEvent=event, daysToSeasonalEvent=daily["daysTo"], daysSinceSeasonalEvent=daily["daysSince"],
                           inboundDemandIndex=daily["vessel"] + .24 * (event in (4, 5, 6, 10)),
                           terminalOccupancy=daily["occupancy"], truckPickupCapacity=daily["truck"],
                           vesselArrivalPressure=daily["vessel"], craneAvailability=daily["crane"],
                           congestion=congestion, dwellTimeDays=dwell)
                if writer is None:
                    writer = csv.DictWriter(stream, fieldnames=list(row))
                    writer.writeheader()
                writer.writerow(row)
                distribution[COMMODITIES[commodity]] += 1
                if identifier % max(1, size // 60) == 0 and len(sample) < 60:
                    sample.append(row)
    manifest.update(commodityCounts=distribution, fabricatedReceivers=len(RECEIVERS), eventTypes=len(EVENTS)-1,
                    sha256={name: hashlib.sha256((DATA / name).read_bytes()).hexdigest()
                            for name in ("containers.csv", "daily-demand.csv")},
                    validation={"orderedArrivalTimestamps": True, "labelsAfterArrival": True,
                                "receiverStatisticsUseCompletedPickupsOnly": True})
    write_json(DATA / "dataset-manifest.json", manifest)
    sample_inputs = demo(events)
    write_json(PUBLIC / "demo-data/jebel-ali.json", sample_inputs)
    write_json(DATA / "receivers.json", sample_inputs["receivers"])
    write_json(DATA / "vessel-schedules.json", sample_inputs["vessels"])
    write_json(DATA.parent / "calendars/regional-events.json", {"windows": events, "labels": EVENTS,
               "basis": "Illustrative scenario anchors in Asia/Dubai"})
    for file, key in (("initial-containers", "initial"), ("incoming-containers", "incoming"),
                      ("operating-scenarios", "scenarios")):
        write_json(DATA.parent / f"demo/{file}.json", sample_inputs[key])
    write_json(DATA.parent / "demo/facility.json", {"cells": sample_inputs["cells"],
               "cranes": [{"id": "STACKER-01", "racks": ["A", "B"]}], "zone": "Asia/Dubai"})
    write_json(PUBLIC / "evidence/dataset.json", {"manifest": manifest, "sample": sample,
                "daily": [d for index, d in enumerate(days) if index % 7 == 0]})
    with (PUBLIC / "evidence/container-sample.csv").open("w", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(sample[0]))
        writer.writeheader()
        writer.writerows(sample)
    print(f"Generated {size:,} containers and {len(days):,} daily observations")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--size", default=150_000, type=int)
    parser.add_argument("--seed", default=SEED, type=int)
    args = parser.parse_args()
    generate(args.size, args.seed)
