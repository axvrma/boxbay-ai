"""Versioned simulation inputs and public event contracts. Times are seconds."""
from datetime import datetime
from enum import StrEnum
from typing import Annotated, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, model_validator

Identifier = Annotated[str, Field(min_length=1, max_length=32, pattern=r"^[a-zA-Z0-9_-]+$")]
Seconds = Annotated[int, Field(ge=0, le=86_400)]
Weight = Annotated[float, Field(gt=0, le=60_000)]
Size = Literal[20, 40, 45]
Policy = Literal["fifo", "legacy", "reactive", "predictive"]
Point = tuple[float, float, float]
ScenarioName = Literal[
    "normal", "high-occupancy", "multi-vessel", "surge", "unexpected", "late-vessel",
    "breakdown", "restricted", "override", "priority", "pickup-delay", "energy",
    "forecast-error", "topology",
]


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Rack(Contract):
    id: Identifier
    bays: int = Field(default=8, ge=1, le=24)
    levels: int = Field(default=5, ge=1, le=10)
    positions: int = Field(default=1, ge=1, le=2)
    bay_pitch_m: float = Field(default=15, ge=14.5, le=40)
    level_pitch_m: float = Field(default=3.4, ge=3.1, le=8)
    x: float = Field(default=0, ge=0, le=1000)
    z: float = Field(default=0, ge=0, le=500)
    sizes: tuple[Size, ...] = (20, 40, 45)
    max_kg: Weight = 36_000
    reefer_bays: int = Field(default=2, ge=0, le=24)
    hazards: tuple[Identifier, ...] = ()
    oog_allowed: bool = False
    available: bool = True


class Crane(Contract):
    id: Identifier
    racks: tuple[Identifier, ...] = Field(min_length=1, max_length=8)
    zone: Identifier
    available: bool = True
    max_kg: Weight = 40_000
    travel_mps: float = Field(default=3, ge=0.25, le=12)
    hoist_mps: float = Field(default=1.3, ge=0.25, le=6)
    handling_s: int = Field(default=14, ge=4, le=120)
    aux_kw: float = Field(default=7, ge=0, le=50)
    idle_kw: float = Field(default=1.4, ge=0, le=20)
    tare_kg: float = Field(default=5000, ge=0, le=30_000)
    traction_kwh_per_m: float = Field(default=0.006, ge=0, le=0.2)
    lift_efficiency: float = Field(default=0.78, ge=0.2, le=1)
    regeneration: float = Field(default=0.26, ge=0, le=0.9)


class Restriction(Contract):
    slot: str = Field(max_length=56)
    blocked: bool = False
    reserve_for: Identifier | None = None
    reason: str = Field(default="Operator policy", max_length=120)


class OperatingPolicy(Contract):
    transfer_capacity: Literal[1] = 1
    hazard_separation_bays: int = Field(default=1, ge=0, le=12)
    energy_weight: float = Field(default=32, ge=0, le=500)
    service_window_s: int = Field(default=260, ge=30, le=1800)
    planning_window_s: int = Field(default=1000, ge=60, le=7200)
    max_batch: int = Field(default=5, ge=1, le=8)


class TraySystem(Contract):
    speed_mps: float = Field(default=5.5, ge=0.5, le=10)
    docking_s: int = Field(default=3, ge=1, le=60)
    empty_kwh_per_m: float = Field(default=0.0012, ge=0, le=0.1)
    load_kwh_per_tonne_m: float = Field(default=0.00013, ge=0, le=0.02)


class Slot(Contract):
    id: str
    rack: Identifier
    bay: int
    level: int
    position: int
    xyz: Point
    sizes: tuple[Size, ...]
    reefer: bool
    hazards: tuple[Identifier, ...]
    oog_allowed: bool
    max_kg: Weight


class Facility(Contract):
    id: Identifier = "pola-demo"
    version: int = Field(default=1, ge=1)
    name: str = Field(default="Harbor Storage Lab", min_length=1, max_length=80)
    location: str = Field(default="Los Angeles, California", max_length=80)
    timezone: str = Field(default="America/Los_Angeles", max_length=80)
    racks: tuple[Rack, ...] = Field(min_length=1, max_length=8)
    cranes: tuple[Crane, ...] = Field(min_length=1, max_length=8)
    restrictions: tuple[Restriction, ...] = Field(default=(), max_length=256)
    operations: OperatingPolicy = Field(default_factory=OperatingPolicy)
    tray: TraySystem = Field(default_factory=TraySystem)
    grid_kg_per_kwh: float = Field(default=429.983 * 0.45359237 / 1000, ge=0, le=2)

    def slots(self) -> dict[str, Slot]:
        return {
            f"{rack.id}:{bay + 1}:{level + 1}:{pos + 1}": Slot(
                id=f"{rack.id}:{bay + 1}:{level + 1}:{pos + 1}", rack=rack.id,
                bay=bay + 1, level=level + 1, position=pos + 1,
                xyz=(rack.x + 8 + bay * rack.bay_pitch_m, 5 + level * rack.level_pitch_m, rack.z + pos * 4),
                sizes=rack.sizes, reefer=bay < rack.reefer_bays, hazards=rack.hazards,
                oog_allowed=rack.oog_allowed, max_kg=rack.max_kg,
            )
            for rack in self.racks for bay in range(rack.bays)
            for level in range(rack.levels) for pos in range(rack.positions)
        }

    def crane_home(self, crane: Crane) -> Point:
        rack = next(rack for rack in self.racks if rack.id == crane.racks[0])
        return (rack.x + 8, 1.65, rack.z)

    def handoff(self, slot: Slot) -> Point:
        return (slot.xyz[0], 1.65, slot.xyz[2])

    def tray_route(self, slot: Slot) -> tuple[Point, Point, Point]:
        x = min(rack.x for rack in self.racks) - 13
        z = min(rack.z for rack in self.racks) - 8
        return ((x, 1.65, z), (x, 1.65, slot.xyz[2]), self.handoff(slot))

    @model_validator(mode="after")
    def topology(self):
        try:
            ZoneInfo(self.timezone)
        except (ValueError, ZoneInfoNotFoundError) as exc:
            raise ValueError("Unknown facility timezone") from exc
        rack_ids = {rack.id for rack in self.racks}
        if len(rack_ids) != len(self.racks) or len({c.id for c in self.cranes}) != len(self.cranes):
            raise ValueError("Rack and crane IDs must be unique")
        if any(len(c.racks) != 1 for c in self.cranes) or sorted(c.racks[0] for c in self.cranes) != sorted(rack_ids):
            raise ValueError("Each rack must have exactly one dedicated crane; cranes cannot change racks")
        if sum(r.bays * r.levels * r.positions for r in self.racks) > 1200:
            raise ValueError("At most 1,200 storage positions are supported")
        for index, rack in enumerate(self.racks):
            if not rack.sizes or rack.reefer_bays > rack.bays:
                raise ValueError("Rack size compatibility or reefer bay count is invalid")
            for other in self.racks[index + 1:]:
                x_gap = max(rack.x, other.x) - min(
                    rack.x + rack.bays * rack.bay_pitch_m, other.x + other.bays * other.bay_pitch_m,
                )
                if x_gap < 0 and abs(rack.z - other.z) < 4 * max(rack.positions, other.positions):
                    raise ValueError("Rack footprints overlap")
        restriction_ids = {r.slot for r in self.restrictions}
        if len(restriction_ids) != len(self.restrictions) or restriction_ids - self.slots().keys():
            raise ValueError("Restrictions must each identify a distinct existing slot")
        return self


class Container(Contract):
    id: Identifier
    size_ft: Size
    gross_kg: Weight
    carrier: Identifier
    cargo: Literal["dry", "reefer", "hazard", "oog"] = "dry"
    hazard: Identifier | None = None
    hold_until_s: Seconds = 0
    appointment_s: Seconds | None = None
    priority: int = Field(default=1, ge=1, le=5)
    vessel: Identifier | None = None
    appointment_lead_days: float = Field(default=2, ge=0, le=30)
    carrier_delay_days: float | None = Field(default=None, ge=0, le=30)
    service_class: int = Field(default=1, ge=0, le=2)

    @property
    def teu(self) -> float:
        return {20: 1, 40: 2, 45: 2.25}[self.size_ft]

    @model_validator(mode="after")
    def hazard_class(self):
        if (self.cargo == "hazard") != bool(self.hazard):
            raise ValueError("Hazardous cargo requires a configured classification")
        return self


class VesselRevision(Contract):
    vessel: Identifier
    notice_s: Seconds
    estimated_arrival_s: Seconds
    inbound_count: int = Field(ge=0, le=300)


class VesselWorkload(Contract):
    id: Identifier
    notice_s: Seconds
    expected_s: Seconds
    updated_s: Seconds
    inbound_count: int = Field(ge=0, le=300)
    outbound_count: int = Field(default=0, ge=0, le=300)
    uncertainty_s: Seconds = 240


class Carrier(Contract):
    id: Identifier
    on_time_probability: float = Field(ge=0, le=1)
    mean_delay_s: Seconds


class Work(Contract):
    container: Container
    release_s: Seconds
    pickup_s: Seconds | None
    initial_slot: str | None = None
    deadline_s: Seconds | None = None
    hard: bool = False

    @model_validator(mode="after")
    def chronological(self):
        if self.pickup_s is not None and self.pickup_s < self.release_s:
            raise ValueError("Pickup precedes release")
        if self.deadline_s is not None and (self.pickup_s is None or self.deadline_s < self.pickup_s):
            raise ValueError("Pickup deadline precedes pickup or no pickup exists")
        if self.initial_slot is not None and self.release_s != 0:
            raise ValueError("Initial inventory must be present at time zero")
        return self


class Intervention(Contract):
    kind: Literal["failure", "recovery", "block", "unblock", "override"]
    at_s: Seconds
    target: str = Field(max_length=56)
    slot: str | None = Field(default=None, max_length=56)

    @model_validator(mode="after")
    def override_shape(self):
        if (self.kind == "override") != bool(self.slot):
            raise ValueError("Override requires a destination slot")
        return self


class Scenario(Contract):
    id: Identifier
    version: int = Field(default=1, ge=1)
    name: str = Field(max_length=80)
    seed: int = Field(ge=0, le=2**32 - 1)
    start: datetime = datetime.fromisoformat("2025-09-01T07:00:00-07:00")
    horizon_s: int = Field(default=4800, ge=180, le=28_800)
    facility: Facility
    work: tuple[Work, ...] = Field(max_length=300)
    vessels: tuple[VesselWorkload, ...] = Field(default=(), max_length=20)
    carriers: tuple[Carrier, ...] = Field(default=(), max_length=100)
    interventions: tuple[Intervention, ...] = Field(default=(), max_length=40)
    forecast_multiplier: float = Field(default=1, ge=0, le=5)

    @model_validator(mode="after")
    def references(self):
        ids = {w.container.id for w in self.work}
        slots = self.facility.slots()
        starting = [w.initial_slot for w in self.work if w.initial_slot is not None]
        if self.start.utcoffset() is None:
            raise ValueError("Scenario start requires a timezone offset")
        if len(ids) != len(self.work) or len(set(starting)) != len(starting) or set(starting) - slots.keys():
            raise ValueError("Duplicate inventory or unknown initial slot")
        if any(w.release_s > self.horizon_s for w in self.work):
            raise ValueError("Release exceeds scenario horizon")
        vessels = {v.id for v in self.vessels}
        notices = {(v.id, v.notice_s) for v in self.vessels}
        if len(notices) != len(self.vessels) or any(
            w.container.vessel and w.container.vessel not in vessels for w in self.work
        ):
            raise ValueError("Vessel notice timestamps must be unique per vessel and cargo must reference a known vessel")
        cranes = {crane.id for crane in self.facility.cranes}
        for i in self.interventions:
            targets = cranes if i.kind in ("failure", "recovery") else ids if i.kind == "override" else slots
            if i.target not in targets or i.slot and i.slot not in slots or i.at_s > self.horizon_s:
                raise ValueError("Invalid intervention target, destination or time")
        return self


class EventKind(StrEnum):
    FORECAST = "DEMAND_FORECAST_UPDATED"
    VESSEL = "VESSEL_WORKLOAD_UPDATED"
    ARRIVAL = "CONTAINER_ARRIVED"
    PICKUP = "CONTAINER_DEPARTURE_REQUESTED"
    PICKUP_WAITING = "PICKUP_WAITING_FOR_RACK_CRANE"
    RESERVED = "SLOT_RESERVED"
    OCCUPIED = "SLOT_OCCUPIED"
    RELEASED = "SLOT_RELEASED"
    ASSIGNED = "CRANE_TASK_ASSIGNED"
    TRAY_STARTED = "TRAY_MOVE_STARTED"
    TRAY_ARRIVED = "TRAY_MOVE_COMPLETED"
    HANDOFF = "CONTAINER_HANDOFF"
    TASK_COMPLETED = "HANDLING_TASK_COMPLETED"
    HANDLING_CANCELLED = "HANDLING_TASK_CANCELLED"
    STARTED = "CRANE_MOVE_STARTED"
    COMPLETED = "CRANE_MOVE_COMPLETED"
    SUSPENDED = "CRANE_MOVE_SUSPENDED"
    FAILED = "CRANE_FAILED"
    RECOVERED = "CRANE_RECOVERED"
    BLOCKED = "SLOT_BLOCKED"
    UNBLOCKED = "SLOT_UNBLOCKED"
    OVERRIDE = "OPERATOR_OVERRIDE_REQUESTED"
    APPLIED = "OPERATOR_OVERRIDE_APPLIED"
    REJECTED = "OPERATOR_OVERRIDE_REJECTED"
    OPTIMIZED = "OPTIMIZATION_COMPLETED"
    RISK = "SLA_AT_RISK"
    BREACH = "SLA_BREACHED"
    FINISHED = "SIMULATION_FINISHED"


class Event(Contract):
    id: str
    t: int
    version: int
    kind: EventKind
    task: str | None = None
    container: str | None = None
    slot: str | None = None
    crane: str | None = None
    data: dict = Field(default_factory=dict)
