"""Versioned request-driven service. Recorded evidence can also be served statically."""
import json
import logging
import os
import secrets
from collections import deque
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from hashlib import sha256
from threading import Event as Signal, Lock
from time import monotonic
from typing import Annotated, Literal
from uuid import uuid4

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import Field
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from .benchmarks import Benchmark, experiment
from .domain import Contract, Event, Facility, Identifier, Intervention, Policy, Scenario, ScenarioName, VesselRevision
from .forecasting import EVIDENCE, model_version
from .persistence import Store
from .scenarios import CATALOG, facility, make_scenario, revise_vessel
from .simulation import Decision, Metrics, Run, Simulator

log = logging.getLogger("boxbay.api")
PREFIX = "/api/v1"
NO_CACHE = {"Cache-Control": "no-store"}


class ScenarioEntry(Contract):
    id: str
    name: str
    description: str
    recorded: bool


class RunInput(Contract):
    scenario: ScenarioName
    seed: int = Field(default=102, ge=0, le=2**32 - 1)
    policy: Policy = "predictive"
    facility: Facility | None = None
    snapshot: Identifier | None = None
    interventions: tuple[Intervention, ...] = Field(default=(), max_length=20)
    vessel_revisions: tuple[VesselRevision, ...] = Field(default=(), max_length=5)


class ExperimentInput(Contract):
    scenario: ScenarioName
    seeds: tuple[int, ...] = Field(min_length=1, max_length=6)
    baseline: Policy = "reactive"
    policy: Policy = "predictive"
    facility: Facility | None = None


class OverrideInput(Contract):
    config: RunInput
    container: Identifier
    slot: str = Field(max_length=56)
    at_s: int = Field(ge=0, le=28_800)


class JobStatus(Contract):
    id: str
    kind: Literal["run", "benchmark", "preview"]
    status: Literal["queued", "running", "complete", "cancelled", "failed"]
    message: str | None = None


class RunPage(Contract):
    offset: int
    total: int
    items: list[Event]


class DecisionPage(Contract):
    offset: int
    total: int
    items: list[Decision]


class Health(Contract):
    status: str
    schema_version: int = 1
    model_version: str
    operator_access: bool


@dataclass
class Job:
    info: JobStatus
    owner: str
    signal: Signal = field(default_factory=Signal)
    changed: float = field(default_factory=monotonic)


@dataclass
class Jobs:
    store: Store
    pool: ThreadPoolExecutor = field(default_factory=lambda: ThreadPoolExecutor(max_workers=1))
    lock: Lock = field(default_factory=Lock)
    jobs: dict[str, Job] = field(default_factory=dict)
    keys: dict[tuple[str, str], tuple[str, str]] = field(default_factory=dict)
    accesses: dict[str, deque] = field(default_factory=dict)

    def start(self, kind, body, idempotency, owner, action):
        fingerprint = sha256(body.model_dump_json().encode()).hexdigest()
        with self.lock:
            now = monotonic()
            self.jobs = {k: v for k, v in self.jobs.items() if now - v.changed < 3600
                         or v.info.status in ("queued", "running")}
            self.keys = {k: v for k, v in self.keys.items() if v[0] in self.jobs}
            key = (owner, idempotency) if idempotency else None
            if key and key in self.keys:
                job_id, existing = self.keys[key]
                job = self.jobs[job_id]
                if existing != fingerprint or job.info.kind != kind:
                    raise HTTPException(409, "Idempotency key was used with different inputs")
                return job.info
            self.accesses = {k: v for k, v in self.accesses.items() if v and now - v[-1] < 60}
            hits = self.accesses.setdefault(owner, deque())
            while hits and now - hits[0] >= 60:
                hits.popleft()
            if len(hits) >= 10 or sum(j.info.status in ("queued", "running") for j in self.jobs.values()) >= 3:
                raise HTTPException(429, "Experiment capacity reached. Try again shortly.", headers={"Retry-After": "8"})
            id_ = uuid4().hex
            job = Job(JobStatus(id=id_, kind=kind, status="queued"), owner)
            self.jobs[id_] = job
            if key:
                self.keys[key] = (id_, fingerprint)
            hits.append(now)
            self.pool.submit(self.execute, job, action)
            return job.info

    def execute(self, job: Job, action: Callable):
        try:
            with self.lock:
                if job.signal.is_set():
                    return
                job.info = job.info.model_copy(update={"status": "running"})
            output = action(job.info.id, job.signal.is_set)
            with self.lock:
                if not job.signal.is_set():
                    self.store.put(job.info.kind, job.info.id, 1, output.model_dump(mode="json"))
                    job.info = job.info.model_copy(update={"status": "complete"})
        except InterruptedError:
            with self.lock:
                job.info = job.info.model_copy(update={"status": "cancelled"})
        except (ValueError, HTTPException) as exc:
            with self.lock:
                message = exc.detail if isinstance(exc, HTTPException) else str(exc)
                status = "cancelled" if job.signal.is_set() else "failed"
                job.info = job.info.model_copy(update={"status": status, "message": str(message)[:300]})
        except Exception as exc:
            log.error("Job %s failed (%s)", job.info.id, type(exc).__name__)
            with self.lock:
                job.info = job.info.model_copy(update={"status": "failed", "message": "Experiment failed"})
        finally:
            with self.lock:
                job.changed = monotonic()


@asynccontextmanager
async def lifespan(app: FastAPI):
    storage = Store()
    storage.migrate()
    manager = Jobs(storage)
    app.state.jobs = manager
    yield
    for job in manager.jobs.values():
        job.signal.set()
    manager.pool.shutdown(wait=True, cancel_futures=True)
    storage.engine.dispose()


app = FastAPI(title="BOXBAY AI", version="2.0.0", lifespan=lifespan)
origins = os.getenv("BOXBAY_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
app.add_middleware(
    CORSMiddleware, allow_origins=[x.strip() for x in origins.split(",") if x.strip() and x.strip() != "*"],
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Authorization", "Content-Type", "Idempotency-Key"],
)


class BoundPayload:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] not in ("POST", "PUT"):
            await self.app(scope, receive, send)
            return
        cap = 512 * 1024
        payload = bytearray()
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            chunk = message.get("body", b"")
            if len(payload) + len(chunk) > cap:
                response = JSONResponse(
                    {"error": {"code": "request_too_large", "message": "JSON input exceeds 512 KiB"}},
                    status_code=413, headers=NO_CACHE,
                )
                await response(scope, receive, send)
                return
            payload.extend(chunk)
            if not message.get("more_body", False):
                break
        sent = False

        async def buffered():
            nonlocal sent
            if sent:
                return await receive()
            sent = True
            return {"type": "http.request", "body": bytes(payload), "more_body": False}

        await self.app(scope, buffered, send)


app.add_middleware(BoundPayload)


@app.exception_handler(StarletteHTTPException)
async def api_error(request, exc):
    return JSONResponse({"error": {"code": f"http_{exc.status_code}", "message": exc.detail}},
                        status_code=exc.status_code, headers={**NO_CACHE, **(exc.headers or {})})


@app.exception_handler(RequestValidationError)
async def validation_error(request, exc):
    return JSONResponse({"error": {"code": "validation", "message": "Invalid request",
                                   "fields": [{"path": ".".join(map(str, item["loc"])), "message": item["msg"]}
                                              for item in exc.errors()]}}, status_code=422, headers=NO_CACHE)


@app.exception_handler(SQLAlchemyError)
async def persistence_error(request, exc):
    log.error("Persistence request failed (%s)", type(exc).__name__)
    return JSONResponse({"error": {"code": "storage_unavailable", "message": "Storage is unavailable"}},
                        status_code=503, headers=NO_CACHE)


def credentials():
    return os.getenv("BOXBAY_OPERATOR_TOKEN"), os.getenv("BOXBAY_ADMIN_TOKEN")


def authorized(request: Request, authorization: Annotated[str | None, Header()] = None) -> str:
    operator, admin = credentials()
    key = (authorization or "").removeprefix("Bearer ")
    for secret in (admin, operator):
        if secret and authorization and authorization.startswith("Bearer ") and secrets.compare_digest(key, secret):
            return sha256(key.encode()).hexdigest()
    if not (operator or admin) and os.getenv("BOXBAY_LOCAL_OPEN") == "1" and (
        request.client and request.client.host in ("127.0.0.1", "::1", "testclient")
    ):
        return "local"
    raise HTTPException(401, "An operator token is required")


def administrator(request: Request, authorization: Annotated[str | None, Header()] = None) -> str:
    owner = authorized(request, authorization)
    admin = credentials()[1]
    if owner == "local" or (admin and secrets.compare_digest(owner, sha256(admin.encode()).hexdigest())):
        return owner
    raise HTTPException(403, "An administrator token is required")


def jobs(request: Request) -> Jobs:
    return request.app.state.jobs


Manager = Annotated[Jobs, Depends(jobs)]
Operator = Annotated[str, Depends(authorized)]
Admin = Annotated[str, Depends(administrator)]
Key = Annotated[str | None, Header(alias="Idempotency-Key", max_length=80)]


@app.get(PREFIX + "/health", response_model=Health)
def health():
    return Health(status="ok", model_version=model_version(),
                  operator_access=bool(any(credentials()) or os.getenv("BOXBAY_LOCAL_OPEN") == "1"))


@app.get(PREFIX + "/ready", response_model=Health)
def ready(manager: Manager):
    with manager.store.engine.connect() as conn:
        conn.execute(text("SELECT 1"))
    return health()


def upgrade_facility(value: dict) -> dict:
    if "tray" in value:
        return value
    cranes = value["cranes"]
    used = {crane["id"] for crane in cranes}
    dedicated = []
    for index, rack in enumerate(value["racks"], 1):
        owner = next((crane for crane in cranes if crane["racks"][0] == rack["id"]
                      and all(selected["id"] != crane["id"] for selected in dedicated)), None)
        if owner is None:
            id_ = f"DED-{index:02}"
            while id_ in used:
                index += 1
                id_ = f"DED-{index:02}"
            used.add(id_)
            owner = {**cranes[0], "id": id_, "available": False}
        dedicated.append({**owner, "racks": [rack["id"]], "zone": rack["id"]})
    return {**value, "cranes": dedicated, "operations": {**value.get("operations", {}), "transfer_capacity": 1}}


@app.get(PREFIX + "/facilities", response_model=list[Facility])
def facilities(manager: Manager, offset: int = Query(0, ge=0), limit: int = Query(20, ge=1, le=50)):
    return ([facility()] if offset == 0 else []) + [upgrade_facility(item) for item in manager.store.list("facility", offset, limit)]


@app.get(PREFIX + "/facilities/{id_}", response_model=Facility)
def get_facility(id_: Identifier, manager: Manager, version: int | None = Query(None, ge=1)):
    item = manager.store.get("facility", id_, version)
    if item is None and id_ == "pola-demo" and version in (1, None):
        return facility()
    if item is None:
        raise HTTPException(404, "Unknown facility version")
    return upgrade_facility(item)


@app.put(PREFIX + "/facilities/{id_}", response_model=Facility)
def save_facility(id_: Identifier, config: Facility, manager: Manager, owner: Admin):
    if config.id != id_:
        raise HTTPException(422, "Facility IDs must match")
    previous = manager.store.get("facility", id_)
    expected = previous["version"] + 1 if previous else 2 if id_ == "pola-demo" else 1
    if config.version != expected:
        raise HTTPException(409, f"Expected facility version {expected}")
    try:
        manager.store.put("facility", id_, config.version, config.model_dump(mode="json"))
    except IntegrityError:
        raise HTTPException(409, "Facility changed concurrently") from None
    return config


@app.get(PREFIX + "/scenarios", response_model=list[ScenarioEntry])
def scenarios():
    recorded = {"surge", "unexpected", "breakdown", "override", "energy"}
    return [ScenarioEntry(id=k, name=name, description=desc, recorded=k in recorded)
            for k, (name, desc) in CATALOG.items()]


@app.post(PREFIX + "/scenarios", response_model=Scenario, status_code=201)
def save_scenario(
    config: Scenario, manager: Manager, owner: Operator, snapshot_id: Identifier | None = Query(None),
):
    try:
        Simulator(config, "fifo", "validation")
        manager.store.put("snapshot", snapshot_id or config.id, config.version, config.model_dump(mode="json"))
    except IntegrityError:
        raise HTTPException(409, "Scenario version already exists") from None
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None
    return config


@app.get(PREFIX + "/scenarios/{id_}", response_model=Scenario)
def snapshot(id_: Identifier, manager: Manager, owner: Operator, version: int | None = Query(None, ge=1)):
    data = manager.store.get("snapshot", id_, version)
    if data is None:
        raise HTTPException(404, "Unknown scenario snapshot")
    return {**data, "facility": upgrade_facility(data["facility"])}


def prepare(payload: RunInput, manager: Jobs) -> Scenario:
    if payload.snapshot:
        saved = manager.store.get("snapshot", payload.snapshot)
        if not saved:
            raise HTTPException(404, "Unknown scenario snapshot")
        config = Scenario.model_validate({**saved, "facility": upgrade_facility(saved["facility"])})
    else:
        config = make_scenario(payload.scenario, payload.seed, payload.facility)
    value = config.model_dump()
    if payload.facility:
        value["facility"] = payload.facility.model_dump()
    value["interventions"] = (*config.interventions, *payload.interventions)
    try:
        scenario = Scenario.model_validate(value)
        for revision in payload.vessel_revisions:
            scenario = revise_vessel(scenario, revision)
        return scenario
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None


@app.post(PREFIX + "/runs", response_model=JobStatus, status_code=202)
def start_run(payload: RunInput, manager: Manager, owner: Operator, idempotency_key: Key = None):
    return manager.start("run", payload, idempotency_key, owner, lambda id_, cancelled: Simulator(
        prepare(payload, manager), payload.policy, id_, cancelled,
    ).run())


@app.post(PREFIX + "/benchmarks", response_model=JobStatus, status_code=202)
def start_benchmark(payload: ExperimentInput, manager: Manager, owner: Operator, idempotency_key: Key = None):
    if (payload.baseline == payload.policy or len(set(payload.seeds)) != len(payload.seeds)
            or any(not 0 <= s < 2**32 for s in payload.seeds)):
        raise HTTPException(422, "Use distinct policies and unique unsigned 32-bit seeds")
    return manager.start("benchmark", payload, idempotency_key, owner, lambda id_, cancelled: experiment(
        payload.scenario, payload.seeds, (payload.baseline, payload.policy), id_, payload.facility, cancelled,
    ))


@app.post(PREFIX + "/optimization/validate-override", response_model=JobStatus, status_code=202)
def validate_override(payload: OverrideInput, manager: Manager, owner: Operator, idempotency_key: Key = None):
    config = payload.config.model_copy(update={
        "interventions": (*payload.config.interventions, Intervention(
            kind="override", target=payload.container, slot=payload.slot, at_s=payload.at_s,
        )),
    })
    return manager.start("preview", payload, idempotency_key, owner, lambda id_, cancelled: Simulator(
        prepare(config, manager), config.policy, id_, cancelled,
    ).run())


@app.get(PREFIX + "/jobs/{id_}", response_model=JobStatus)
def get_job(id_: str, manager: Manager, owner: Operator):
    with manager.lock:
        if (job := manager.jobs.get(id_)) and job.owner == owner:
            return job.info
    raise HTTPException(404, "Unknown job. A process restart requires submitting the experiment again.")


@app.delete(PREFIX + "/jobs/{id_}", response_model=JobStatus)
def cancel_job(id_: str, manager: Manager, owner: Operator):
    with manager.lock:
        if not (job := manager.jobs.get(id_)) or job.owner != owner:
            raise HTTPException(404, "Unknown job")
        if job.info.status in ("queued", "running"):
            job.signal.set()
            job.info = job.info.model_copy(update={"status": "cancelled"})
        return job.info


def stored(manager, kind, id_):
    value = manager.store.get(kind, id_)
    if value is None:
        raise HTTPException(404, "Result is unavailable")
    return value


def stored_run(id_: str, manager: Jobs) -> dict:
    return manager.store.get("run", id_) or stored(manager, "preview", id_)


@app.get(PREFIX + "/runs/{id_}", response_model=Run)
def get_run(id_: Identifier, manager: Manager):
    run = stored_run(id_, manager)
    # A historical replay still uses the geometry and assumptions under which it ran.
    if "tray" not in run["scenario"]["facility"]:
        return JSONResponse(run)
    return run


@app.get(PREFIX + "/runs/{id_}/events", response_model=RunPage)
def events(id_: Identifier, manager: Manager, offset: int = Query(0, ge=0), limit: int = Query(100, ge=1, le=500)):
    items = stored_run(id_, manager)["events"]
    return RunPage.model_validate({"offset": offset, "total": len(items), "items": items[offset:offset + limit]})


@app.get(PREFIX + "/runs/{id_}/decisions", response_model=DecisionPage)
def decisions(id_: Identifier, manager: Manager, offset: int = Query(0, ge=0), limit: int = Query(100, ge=1, le=500)):
    items = stored_run(id_, manager)["decisions"]
    return DecisionPage.model_validate({"offset": offset, "total": len(items), "items": items[offset:offset + limit]})


@app.get(PREFIX + "/runs/{id_}/metrics", response_model=Metrics)
def metrics(id_: Identifier, manager: Manager):
    return stored_run(id_, manager)["metrics"]


def evidence(filename):
    path = EVIDENCE / filename
    if not path.is_file():
        raise HTTPException(503, "Recorded evidence has not been generated")
    return json.loads(path.read_text())


@app.get(PREFIX + "/benchmarks", response_model=Benchmark)
def recorded_benchmark():
    return evidence("benchmarks.json")


@app.get(PREFIX + "/benchmarks/{id_}", response_model=Benchmark)
def get_benchmark(id_: Identifier, manager: Manager):
    return stored(manager, "benchmark", id_)


@app.get(PREFIX + "/models/metadata")
def models():
    return evidence("models.json")


@app.get(PREFIX + "/forecasts")
def forecasts():
    return evidence("models.json")["demand"]


@app.get(PREFIX + "/sources")
def sources():
    return evidence("sources.json")
