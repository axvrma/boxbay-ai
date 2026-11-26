"""Small portable inference artifacts. Runtime ships without the training stack."""
import json
from datetime import datetime
from functools import lru_cache
from pathlib import Path
from statistics import mean
from struct import pack, unpack
from typing import Any

from .domain import Container, Scenario, VesselWorkload

ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = ROOT / "apps/web/public/evidence"
ARTIFACT = ROOT / "data/models/model-v1.json"


@lru_cache(maxsize=1)
def bundle() -> dict[str, Any]:
    try:
        data = json.loads(ARTIFACT.read_text())
        if data["schema_version"] == 1:
            return data
    except (OSError, ValueError, KeyError):
        pass
    return {}


def model_version() -> str:
    return bundle().get("version", "fallback-v1")


def dwell_features(container: Container) -> list[float]:
    return [
        container.gross_kg / 1000, container.size_ft, float(container.cargo == "reefer"),
        float(container.cargo == "hazard"), container.appointment_lead_days,
        container.carrier_delay_days if container.carrier_delay_days is not None else -1,
        container.service_class,
    ]


def float32(value: float) -> float:
    return unpack("f", pack("f", value))[0]


def evaluate_boosted_tree(tree: dict, features: list[float]) -> float:
    while "leaf" not in tree:
        value = float32(features[int(tree["split"][1:])])
        child = tree["yes"] if value < float32(tree["split_condition"]) else tree["no"]
        tree = next(branch for branch in tree["children"] if branch["nodeid"] == child)
    return float(tree["leaf"])


def dwell(container: Container) -> dict[str, float]:
    model = bundle().get("dwell")
    if model:
        features = dwell_features(container)
        estimate = max(0.1, model["base"] + sum(evaluate_boosted_tree(t, features) for t in model["trees"]))
        radius = model["radius_days"]
    else:
        estimate, radius = max(0.5, container.appointment_lead_days + 0.6), 2.0
    return {"days": estimate, "low_days": max(0.0, estimate - radius), "high_days": estimate + radius}


def demand_features(month: int, history: list[float]) -> list[float]:
    return [month, history[-1], history[-2], history[-3], history[-12], mean(history[-3:]), mean(history[-12:])]


def monthly(direction: str, when: datetime) -> dict[str, Any]:
    model = bundle().get("demand", {}).get(direction)
    if not model:
        return {"available": False, "basis": "Vessel notices only"}
    month = when.strftime("%Y-%m")
    seasonal = model["seasonal_profile"][when.month - 1]
    trained = model.get("rolling_estimates", {}).get(month)
    estimate = trained if trained is not None else seasonal
    radius = model["radius_teu"] if trained is not None else model["profile_radius_teu"]
    return {
        "available": True, "estimate_teu": estimate, "low_teu": max(0, estimate - radius),
        "high_teu": estimate + radius, "seasonal_index": seasonal / model["mean_teu"],
        "forecast_index": estimate / model["mean_teu"],
        "basis": "Port of Los Angeles monthly loaded TEU", "month": month,
        "method": model["selected"] if trained is not None else "historical monthly seasonal profile",
    }


def workload_forecast(scenario: Scenario, notices: dict[str, VesselWorkload], now: int) -> dict:
    inbound = monthly("import", scenario.start)
    outbound = monthly("export", scenario.start)
    horizon = scenario.facility.operations.planning_window_s
    upcoming = [v for v in notices.values() if now <= v.updated_s <= now + horizon]
    notice_count = sum(v.inbound_count for v in upcoming)
    fixture_scale = 8 * inbound.get("forecast_index", 1.0)
    count = (notice_count + fixture_scale) * scenario.forecast_multiplier
    spread = max(2.0, 0.30 * count + sum(v.uncertainty_s for v in upcoming) / 180)
    return {
        "inbound_requests": round(count, 2), "low": round(max(0.0, count - spread), 2),
        "high": round(count + spread, 2), "horizon_s": horizon,
        "notice_count": notice_count, "outbound_requests": round(7 * outbound.get("forecast_index", 1.0), 2),
        "observed_monthly_inbound": inbound, "observed_monthly_outbound": outbound,
        "model_version": model_version(),
        "basis": "Synthetic facility scale, monthly demand model, known vessel notices",
    }
