"""Train, evaluate and export the same numerical contract used in the browser."""
from __future__ import annotations

import argparse
import hashlib
import json
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost
from xgboost import XGBRegressor

from generate_data import CALIBRATION_START, DATA, END, EVENTS, PUBLIC, SEED, START, TEST_START, event_for, write_json

VERSION = "jebel-ali-2022-26-v1"
DWELL = ["Receiver dwell", "Receiver pickup reliability", "Receiver profile", "Commodity", "Trade lane",
         "Container size", "Gross weight", "Handling type", "Priority", "Customs clearance",
         "Month", "Day of week", "Seasonal window", "Days to event", "Days after event", "Inbound pressure",
         "Terminal occupancy", "Truck pickup capacity", "Vessel arrival pressure", "Crane availability", "Congestion"]
DEMAND = ["Month", "Day of week", "Seasonal window", "Days to event", "Days after event", "Vessel arrival pressure",
          "Terminal occupancy", "Congestion", "Truck pickup capacity", "Crane availability"]
PARAMETERS = dict(n_estimators=105, max_depth=4, learning_rate=.08, subsample=.86, colsample_bytree=.85,
                  objective="reg:squarederror", random_state=SEED, n_jobs=4, base_score=0, tree_method="hist")
KINDS = {"dry": 0, "reefer": 1, "hazard": 2}


def assess(actual, estimates):
    residuals = np.asarray(estimates) - np.asarray(actual)
    return dict(n=len(residuals), mae=float(np.abs(residuals).mean()), rmse=float(np.sqrt(np.square(residuals).mean())),
                medianAbsoluteError=float(np.median(np.abs(residuals))), bias=float(residuals.mean()),
                wape=float(np.abs(residuals).sum() / max(1e-9, np.abs(actual).sum())))


def evaluate_tree(tree, vector):
    while "leaf" not in tree:
        value = vector[int(tree["split"][1:])]
        child = tree["missing"] if np.isnan(value) else tree["yes"] if value < np.float32(tree["split_condition"]) else tree["no"]
        tree = next(branch for branch in tree["children"] if branch["nodeid"] == child)
    return tree["leaf"]


def predict_portable(trees, vector):
    vector = np.asarray(vector, dtype=np.float32)
    return max(.25, sum(evaluate_tree(tree, vector) for tree in trees))


def fit(name, x, y, dates, schema, lead=0, complete=None, cohort=None, commodity=None):
    valid_begin = np.datetime64(CALIBRATION_START)
    test_begin = np.datetime64(TEST_START)
    closes = complete if complete is not None else dates + np.timedelta64(lead, "D")
    train = (dates < valid_begin) & (closes < valid_begin) & np.isfinite(y)
    valid = (dates >= valid_begin) & (dates < test_begin) & (closes < test_begin) & np.isfinite(y)
    test = (dates >= test_begin) & np.isfinite(y)
    model = XGBRegressor(**PARAMETERS).fit(x[train], y[train])
    base = np.median(x[train], axis=0).tolist()
    def fresh(vector):
        return np.maximum(.25, model.predict(vector))

    predictions = fresh(x[test])
    calibration = np.abs(fresh(x[valid]) - y[valid])
    rank = min(len(calibration), int(np.ceil((len(calibration)+1)*.9)))
    radius = float(np.partition(calibration, rank-1)[rank-1])
    coverage = float((np.abs(predictions - y[test]) <= radius).mean())
    trees = [json.loads(tree) for tree in model.get_booster().get_dump(dump_format="json")]
    ix = np.flatnonzero(test)
    selections = list(ix[::max(1, len(ix)//14)][:15])
    if cohort is not None and np.any(test & cohort):
        selections.extend(np.flatnonzero(test & cohort)[:3])
    vectors = [x[i].tolist() for i in selections]
    missing = x[selections[0]].tolist()
    missing[0] = np.nan
    vectors.append(missing)
    expected = fresh(np.asarray(vectors, dtype=np.float32))
    np.testing.assert_allclose([predict_portable(trees, v) for v in vectors], expected, atol=5e-5, rtol=2e-6)
    data = dict(name=name, features=schema, baselines=base, trees=trees, radius=radius if coverage >= .85 else None)
    stat = dict(model=assess(y[test], predictions), baseline=assess(y[test], x[test, 0] if name == "dwell" else
                np.full(len(predictions), np.mean(y[train]))), coverage=coverage, radius=radius,
                splits=[int(train.sum()), int(valid.sum()), int(test.sum())],
                residuals=(predictions-y[test])[::max(1,len(predictions)//140)][:150].tolist())
    seasonal_index = schema.index("Seasonal window")
    stat["seasonal"] = {label: assess(y[test][mask], predictions[mask]) for i, label in enumerate(EVENTS)
                        if (mask := (x[test, seasonal_index] == i)).any()}
    if cohort is not None:
        mask = cohort[test]
        stat["unseenReceivers"] = assess(y[test][mask], predictions[mask]) if mask.any() else None
        stat["commodity"] = {str(i): assess(y[test][mask], predictions[mask]) for i in range(10)
                             if (mask := commodity[test] == i).any()}
    fixtures = []
    for vector, estimate in zip(vectors, expected, strict=True):
        changes = np.repeat(np.asarray(vector, dtype=np.float32)[None, :], len(schema), axis=0)
        np.fill_diagonal(changes, base)
        fixtures.append(dict(features=[float(v) if np.isfinite(v) else None for v in vector],
                             value=float(estimate), sensitivities=(estimate - fresh(changes)).tolist()))
    return data, stat, fixtures


def dwell_inputs(cargo, when, context, demo):
    day = date.fromisoformat(when)
    event, until, since = event_for(day, [(w, date.fromisoformat(w["date"])) for w in demo["events"]])
    known = 0 <= cargo["receiver"] < 10
    receiver = demo["receivers"][cargo["receiver"]] if known else {"dwell": 4.6, "reliability": .77}
    return [receiver["dwell"], receiver["reliability"], cargo["receiver"] if known else -1, cargo["commodity"],
            cargo["lane"], cargo["size"], cargo["kg"]/1000, KINDS[cargo["kind"]], cargo["priority"], cargo["customs"],
            day.month, day.weekday(), event, until, since, context["vessel"] + .24*(event in (4, 5, 6, 10)),
            context["occupancy"], context["truck"], context["vessel"], context["cranes"]/2, context["congestion"]]


def main(export_only):
    workspace = DATA / "training-export.json"
    evidence_path = DATA / "training-evidence.json"
    parity_path = DATA / "training-parity.json"
    if not export_only:
        def span(start, end):
            return f"{start:%Y-%m} through {end - timedelta(days=1):%Y-%m}"

        records = pd.read_csv(DATA / "containers.csv")
        timestamps = pd.to_datetime(records["arrivalTimestamp"], format="ISO8601")
        dates = timestamps.dt.tz_localize(None).to_numpy(dtype="datetime64[D]")
        complete = pd.to_datetime(records["departureTimestamp"], format="ISO8601").dt.tz_localize(None).to_numpy(dtype="datetime64[D]")
        display_receiver = records.receiverId.where(records.receiverId < 10, -1)
        x = np.column_stack([records.receiverHistoricalDwellDays, records.receiverPickupReliability,
                             display_receiver, records.commodity, records.tradeLane, records.sizeFt,
                             records.grossWeightKg/1000, records.containerType.map(KINDS), records.priority,
                             records.customsStatusAtArrival, timestamps.dt.month, timestamps.dt.weekday,
                             records.seasonalEvent, records.daysToSeasonalEvent, records.daysSinceSeasonalEvent,
                             records.inboundDemandIndex, records.terminalOccupancy, records.truckPickupCapacity,
                             records.vesselArrivalPressure, records.craneAvailability, records.congestion]).astype(np.float32)
        models, scores, parity = {}, {}, {}
        models["dwell"], scores["dwell"], parity["dwell"] = fit(
            "dwell", x, records.dwellTimeDays.to_numpy(), dates, DWELL, complete=complete,
            cohort=records.receiverId.to_numpy() >= 10, commodity=records.commodity.to_numpy())
        daily = pd.read_csv(DATA / "daily-demand.csv")
        when = pd.to_datetime(daily.date)
        dates = when.to_numpy(dtype="datetime64[D]")
        x = np.column_stack([when.dt.month, when.dt.weekday, daily.event, daily.daysTo, daily.daysSince,
                             daily.vessel, daily.occupancy, daily.congestion, daily.truck, daily.crane]).astype(np.float32)
        targets = {"arrivals": (daily.arrivals.shift(-1), 1), "pickups": (daily.pickups.shift(-1), 1),
                   "week": (sum(daily.arrivals.shift(-i) for i in range(1, 8)), 7)}
        for name, (target, lead) in targets.items():
            models[name], scores[name], parity[name] = fit(name, x, target.to_numpy(), dates, DEMAND, lead=lead)
        demo = json.loads((PUBLIC / "demo-data/jebel-ali.json").read_text())
        raw = []
        for index, when, scenario in [(0,demo["defaultDate"],0),(0,"2026-03-10",0),(2,"2026-02-18",5),
                                      (31,"2028-11-11",7)]:
            cargo = demo["incoming"][index]
            context = demo["scenarios"][scenario]
            features = dwell_inputs(cargo, when, context, demo)
            raw.append(dict(cargo=cargo, date=when, context=context, features=features,
                            value=predict_portable(models["dwell"]["trees"], features)))
        bundle = dict(schema=1, version=VERSION, models=models)
        evidence = dict(schema=1, version=VERSION, library=f"XGBoost {xgboost.__version__}",
                        source="Synthetic Jebel Ali operational data", parameters=PARAMETERS, metrics=scores,
                        training=span(START, CALIBRATION_START), calibration=span(CALIBRATION_START, TEST_START),
                        test=span(TEST_START, END), generatedFrom=json.loads((DATA/"dataset-manifest.json").read_text())["sha256"])
        write_json(workspace, bundle)
        write_json(evidence_path, evidence)
        write_json(parity_path, dict(version=VERSION, vectors=parity, raw=raw))
    target = PUBLIC / "models" / f"{VERSION}.json"
    target.write_bytes(workspace.read_bytes())
    evidence = json.loads(evidence_path.read_text())
    evidence.update(artifactBytes=target.stat().st_size, artifactSha256=hashlib.sha256(target.read_bytes()).hexdigest())
    write_json(PUBLIC / "evidence/model-evaluation.json", evidence)
    Path("tests").mkdir(exist_ok=True)
    Path("tests/model-parity.json").write_bytes(parity_path.read_bytes())
    print(json.dumps({key: value["model"] for key, value in evidence["metrics"].items()}, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--export-only", action="store_true")
    main(parser.parse_args().export_only)
