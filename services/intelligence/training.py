"""Offline model fitting, temporal evaluation, lineage and portable JSON export."""
import json
from hashlib import sha256
from math import ceil
from random import Random
from statistics import mean
from typing import Any

import numpy as np
import pandas as pd
from xgboost import XGBRegressor

from .domain import Container
from .forecasting import ARTIFACT, EVIDENCE, ROOT, demand_features, dwell_features, evaluate_boosted_tree

SOURCE = ROOT / "data/sources/pola-monthly-v1.csv"
SEED = 202511


def historical() -> pd.DataFrame:
    data = pd.read_csv(SOURCE)
    volume = data.drop(columns=["month"])
    expected = pd.period_range("2010-01", "2025-12", freq="M").astype(str).tolist()
    if data.month.tolist() != expected or volume.isna().any().any() or (volume < 0).any().any():
        raise ValueError("Port series has gaps, duplicates, or invalid TEU")
    return data


def generator(data: pd.DataFrame, size: int = 6600, seed: int = SEED) -> list[dict]:
    rng = Random(seed)
    uncertainty = [rng.uniform(0.15, 1.2) for _ in range(26)]
    periods = data.iloc[-60:].reset_index(drop=True)
    probabilities = periods.loaded_import_teu.tolist()
    order = sorted(rng.choices(range(len(periods)), weights=probabilities, k=size))
    rows = []
    for i, index in enumerate(order):
        period = str(periods.iloc[index].month)
        # A time-based carrier cohort shift creates a separate cold-start test.
        carrier = rng.randrange(18) if index < 51 or rng.random() > 0.30 else rng.randrange(18, 26)
        service = rng.choices([0, 1, 2], [0.21, 0.64, 0.15])[0]
        cargo = rng.choices(["dry", "reefer", "hazard"], [0.86, 0.12, 0.02])[0]
        length = rng.choices([20, 40, 45], [0.25, 0.73, 0.02])[0]
        kg = min(36_000, max(4100, rng.gauss(14_000 if length == 20 else 23_000, 3600)))
        arrival_day = rng.randint(1, pd.Period(period).days_in_month)
        arrival = pd.Timestamp(f"{period}-{arrival_day:02}") + pd.Timedelta(hours=rng.randrange(24))
        lead = max(0.25, rng.gammavariate(2.3, 0.65 if service == 0 else 1.25))
        vessel_delay = rng.gammavariate(1.3, 0.28)
        history = uncertainty[carrier] if carrier < 18 and rng.random() > 0.05 else None
        carrier_delay = rng.expovariate(1 / uncertainty[carrier]) if rng.random() < 0.70 else 0
        hold = rng.uniform(0.2, 3) if rng.random() < (0.35 if cargo == "hazard" else 0.08) else 0
        appointment = arrival + pd.Timedelta(days=lead)
        realized = max(0.1, lead + 0.35 * vessel_delay + carrier_delay + hold + rng.gauss(0, 0.55))
        box = Container(
            id=f"SYN-{i + 1:06}", size_ft=length, gross_kg=kg, cargo=cargo,
            hazard="H1" if cargo == "hazard" else None, carrier=f"C{carrier:02}",
            appointment_lead_days=lead, carrier_delay_days=history, service_class=service,
        )
        rows.append({
            "arrival": arrival.isoformat(), "vessel_scheduled": (arrival - pd.Timedelta(days=vessel_delay)).isoformat(),
            "appointment": appointment.isoformat(), "pickup": (arrival + pd.Timedelta(days=realized)).isoformat(),
            "vessel_delay_days": vessel_delay, "teu": box.teu, "dwell_days": realized,
            **box.model_dump(), "features": dwell_features(box), "unseen_carrier": carrier >= 18,
        })
    return sorted(rows, key=lambda r: (r["arrival"], r["id"]))


def quality(rows: list[dict]) -> None:
    assert len({r["id"] for r in rows}) == len(rows)
    assert all(r["vessel_scheduled"] <= r["arrival"] < r["pickup"] and r["arrival"] < r["appointment"]
               and r["teu"] == r["size_ft"] / 20 and r["dwell_days"] > 0 for r in rows)


def assess(y, prediction, low=None, high=None) -> dict:
    actual, estimates = np.asarray(y), np.asarray(prediction)
    residual = estimates - actual
    result = {
        "n": len(actual), "mae": float(np.mean(np.abs(residual))), "rmse": float(np.sqrt(np.mean(residual**2))),
        "wape_pct": float(100 * np.sum(np.abs(residual)) / np.sum(actual)), "bias": float(np.mean(residual)),
    }
    peaks = actual >= np.quantile(actual, 0.75)
    result["peak_mae"] = float(np.mean(np.abs(residual[peaks])))
    if low is not None:
        result["coverage_pct"] = float(100 * np.mean((actual >= low) & (actual <= high)))
    return result


def radius(y, predictions, coverage=0.90) -> float:
    errors = sorted(abs(a - b) for a, b in zip(y, predictions, strict=True))
    return float(errors[min(len(errors) - 1, ceil((len(errors) + 1) * coverage) - 1)])


def boosted(depth, trees) -> XGBRegressor:
    return XGBRegressor(
        n_estimators=trees, max_depth=depth, learning_rate=0.06, base_score=0, subsample=0.9,
        random_state=SEED, n_jobs=1, objective="reg:squarederror",
    )


def fit_monthly(df, direction):
    values = df[f"loaded_{direction}_teu"].tolist()
    months = df.month.tolist()
    observed = pd.to_datetime(df.month)
    feature_rows = [demand_features(int(observed[i].month), values[:i]) for i in range(12, len(values))]

    def estimate(index):
        x = np.asarray(feature_rows[:index - 12])
        y = np.asarray(values[12:index])
        scale = float(y.mean())
        model = boosted(2, 72).fit(x, y / scale)
        features = np.asarray([demand_features(int(months[index][-2:]) if index < len(months) else 1, values[:index])])
        seasonal = values[index - 12]
        average = mean([values[index - 12 * year] for year in (1, 2, 3)])
        return [seasonal, average, float(model.predict(features)[0]) * scale]

    out = np.asarray([estimate(i) for i in range(144, len(values))])
    actual = np.asarray(values[144:])
    names = ["seasonal_naive", "seasonal_3yr_mean", "xgboost"]
    selected = min(range(3), key=lambda i: assess(actual[:24], out[:24, i])["mae"])
    calibration = radius(actual[:24], out[:24, selected])
    test = out[24:, selected]
    records = [{
        "month": month, "observed": float(a), "prediction": float(p),
        "low": float(max(0, p - calibration)), "high": float(p + calibration), "error": float(p - a),
    } for month, a, p in zip(months[168:], actual[24:], test, strict=True)]
    profile = df.assign(calendar_month=observed.dt.month).iloc[:144].groupby("calendar_month")[
        f"loaded_{direction}_teu"
    ].mean().tolist()
    return {
        "selected": names[selected], "seasonal_profile": profile, "mean_teu": mean(profile),
        "profile_radius_teu": radius(actual[:24], [profile[int(m[-2:]) - 1] for m in months[144:168]]),
        "rolling_estimates": {
            **{item["month"]: item["prediction"] for item in records},
            "2026-01": estimate(len(values))[selected],
        },
        "radius_teu": calibration,
    }, {
        "selected": names[selected], "candidate_calibration": {
            n: assess(actual[:24], out[:24, i]) for i, n in enumerate(names)
        },
        "test": {n: assess(actual[24:], out[24:, i]) for i, n in enumerate(names)},
        "selected_test": assess(actual[24:], test, np.maximum(0, test - calibration), test + calibration),
        "holdout": records,
    }


def fit_dwell(rows):
    splits = [[r for r in rows if check(r["arrival"][:7])] for check in (
        lambda m: m < "2024-07", lambda m: "2024-07" <= m < "2025-01", lambda m: m >= "2025-01",
    )]
    train, calib, test = splits

    def arrays(records):
        return np.array([r["features"] for r in records]), np.array([r["dwell_days"] for r in records])

    x, y = arrays(train)
    model = boosted(3, 110).fit(x, y)
    cx, cy = arrays(calib)
    rx, ry = arrays(test)
    estimate = np.maximum(0.1, model.predict(rx))
    calibration = radius(cy, np.maximum(0.1, model.predict(cx)))
    trees = [json.loads(tree) for tree in model.get_booster().get_dump(dump_format="json")]
    portable = np.array([max(0.1, sum(evaluate_boosted_tree(tree, list(row)) for tree in trees)) for row in rx])
    np.testing.assert_allclose(portable, estimate, atol=2e-5)
    cold = np.asarray([r["unseen_carrier"] for r in test])
    baseline_offset = float(np.median(y - x[:, 4]))
    return {"base": 0, "radius_days": calibration, "trees": trees}, {
        "unit": "days", "source": "synthetic", "split_sizes": [len(s) for s in splits],
        "baseline": assess(ry, rx[:, 4] + baseline_offset),
        "test": assess(ry, estimate, np.maximum(0, estimate - calibration), estimate + calibration),
        "unseen_carrier": assess(ry[cold], estimate[cold], np.maximum(0, estimate[cold] - calibration),
                                 estimate[cold] + calibration),
        "holdout": [{"actual": float(a), "prediction": float(p), "error": float(p - a)}
                    for a, p in zip(ry[::6], estimate[::6], strict=True)],
    }


def main():
    data = historical()
    rows = generator(data)
    quality(rows)
    synthetic = ROOT / "data/synthetic/dwell-v1.csv"
    synthetic.parent.mkdir(parents=True, exist_ok=True)
    pd.DataFrame(rows).drop(columns=["features"]).to_csv(synthetic, index=False)
    import_model, import_metrics = fit_monthly(data, "import")
    export_model, export_metrics = fit_monthly(data, "export")
    dwell_model, dwell_metrics = fit_dwell(rows)
    version = "pola-monthly-dwell-xgb-v1"
    metadata: dict[str, Any] = {
        "schema_version": 1, "version": version, "dataset_version": "pola-2010-2025-v1/dwell-synthetic-v1",
        "historical_sha256": sha256(SOURCE.read_bytes()).hexdigest(),
        "synthetic_sha256": sha256(synthetic.read_bytes()).hexdigest(),
        "seed": SEED, "demand": {"import": import_metrics, "export": export_metrics}, "dwell": dwell_metrics,
        "historical": data.to_dict(orient="records"),
    }
    for path, body in (
        (ARTIFACT, {"schema_version": 1, "version": version,
                    "demand": {"import": import_model, "export": export_model}, "dwell": dwell_model}),
        (EVIDENCE / "models.json", metadata),
    ):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(body, separators=(",", ":"), allow_nan=False) + "\n")
    print(json.dumps({
        "inbound": import_metrics["selected_test"], "outbound": export_metrics["selected_test"],
        "dwell": dwell_metrics["test"], "unseen_carrier": dwell_metrics["unseen_carrier"],
    }, indent=2))


if __name__ == "__main__":
    main()
