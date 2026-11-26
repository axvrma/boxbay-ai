import json
import time

from fastapi.testclient import TestClient

from services.intelligence.api import app
from services.intelligence.domain import Scenario
from services.intelligence.forecasting import ROOT, bundle, monthly
from services.intelligence.scenarios import make_scenario
from services.intelligence.training import generator, historical, quality


def wait_job(client, id_, token):
    for _ in range(150):
        status = client.get(f"/api/v1/jobs/{id_}", headers=token).json()["status"]
        if status in ("complete", "failed", "cancelled"):
            return status
        time.sleep(0.035)
    raise AssertionError("Job exceeded budget")


def test_api_role_state_and_idempotency(tmp_path, monkeypatch):
    monkeypatch.setenv("BOXBAY_STATE_DIR", str(tmp_path))
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setenv("BOXBAY_OPERATOR_TOKEN", "unit-operator")
    monkeypatch.setenv("BOXBAY_ADMIN_TOKEN", "unit-admin")
    token = {"Authorization": "Bearer unit-operator", "Idempotency-Key": "abc"}
    admin = {"Authorization": "Bearer unit-admin"}
    with TestClient(app) as client:
        assert client.get("/api/v1/ready").status_code == 200
        body = {"scenario": "surge", "seed": 101, "policy": "fifo"}
        oversize = client.post("/api/v1/runs", content=b"x" * (512 * 1024 + 1))
        assert oversize.status_code == 413 and oversize.json()["error"]["code"] == "request_too_large"
        first = client.post("/api/v1/runs", json=body)
        assert first.status_code == 401 and first.json()["error"]["code"] == "http_401"
        assert client.post("/api/v1/runs", json={"scenario": "bad"}, headers=token).status_code == 422
        info = client.post("/api/v1/runs", json=body, headers=token)
        assert info.status_code == 202
        run = info.json()["id"]
        assert client.post("/api/v1/runs", json=body, headers=token).json()["id"] == run
        assert client.post("/api/v1/runs", json={**body, "seed": 21}, headers=token).status_code == 409
        assert wait_job(client, run, token) == "complete"
        events = client.get(f"/api/v1/runs/{run}/events?limit=7").json()
        assert len(events["items"]) == 7 < events["total"]
        assert client.get(f"/api/v1/runs/{run}/metrics").json()["moves"] > 0
        config = client.get("/api/v1/facilities/pola-demo").json()
        config["version"] = 2
        assert client.put("/api/v1/facilities/pola-demo", json=config, headers=token).status_code == 403
        assert client.put("/api/v1/facilities/pola-demo", json=config, headers=admin).status_code == 200
        assert client.put("/api/v1/facilities/pola-demo", json=config, headers=admin).status_code == 409
        scenario = make_scenario("priority", 102).model_dump(mode="json")
        response = client.post("/api/v1/scenarios?snapshot_id=demo-snapshot", json=scenario, headers=token)
        assert response.status_code == 201
        assert client.get("/api/v1/scenarios/demo-snapshot", headers=token).json()["id"] == "priority"


def test_data_lineage_and_seeded_generator():
    data = historical()
    assert len(data) == 192
    assert data.iloc[0].month == "2010-01"
    assert abs(data[data.month.str.startswith("2024")].loaded_import_teu.sum() - 5_356_680.15) < .01
    a, b = generator(data, size=250, seed=12), generator(data, size=250, seed=12)
    quality(a)
    assert a == b and a != generator(data, size=250, seed=13)
    assert len(bundle()["dwell"]["trees"]) == 110
    evidence = json.loads((ROOT / "apps/web/public/evidence/models.json").read_text())
    estimate = monthly("import", Scenario.model_fields["start"].default)
    holdout = next(row for row in evidence["demand"]["import"]["holdout"] if row["month"] == estimate["month"])
    assert estimate["estimate_teu"] == holdout["prediction"]
    assert estimate["method"] == evidence["demand"]["import"]["selected"]


def test_openapi_matches_generated_contract():
    file = ROOT / "packages/contracts/openapi.json"
    assert app.openapi() == json.loads(file.read_text())
