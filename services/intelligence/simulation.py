"""One deterministic, in-process event authority for the simulated interface."""
from collections import Counter
from collections.abc import Callable
from dataclasses import asdict, dataclass, field, replace
from functools import lru_cache
from math import ceil
from statistics import mean
from time import perf_counter

import simpy
from pydantic import Field

from .constraints import compatibility, reachable, segregation
from .domain import Contract, Crane, Event, EventKind as K, Point, Policy, Scenario, Slot, Work
from .energy import movement, tray_leg
from .forecasting import dwell, model_version, workload_forecast
from .optimization import HandlingPlan, Option, PlacementFactors, build_plan


class Decision(Contract):
    id: str
    t: int
    state_version: int
    trigger: str
    task: str
    container: str
    action: str
    status: str
    candidate_count: int
    rejected: dict[str, int]
    selected: dict
    alternatives: list[dict]
    prediction: dict
    model_version: str
    override: dict | None = None


class Metrics(Contract):
    moves: int
    pickups: int
    teu: float
    moves_per_hour: float
    on_time_pct: float
    late: int
    at_risk: int
    breakdown_breaches: int
    pickup_wait_s: float
    p95_wait_s: float
    mean_late_s: float
    p95_late_s: float
    kwh: float
    motion_kwh: float
    tray_kwh: float = 0
    idle_kwh: float
    kg_co2e: float
    kwh_per_move: float
    kwh_per_teu: float
    co2e_per_move: float
    co2e_per_teu: float
    backlog: int
    initial_inventory: int
    ending_inventory: int
    peak_backlog: int
    placements: dict[str, int]
    crane_utilization: dict[str, float]
    waits_s: list[int]
    solver_status: dict[str, int]


class Run(Contract):
    schema_version: int = 1
    engine_version: str = "2.1.0"
    dataset_version: str = "pola-2010-2025-v1/synthetic-workload-v1"
    id: str
    policy: Policy
    scenario: Scenario
    slots: list[Slot]
    model_version: str
    events: list[Event]
    decisions: list[Decision]
    metrics: Metrics
    elapsed_ms: float = Field(ge=0)
    solver_ms: list[float]


@dataclass
class Task:
    key: str
    work: Work
    kind: str
    created: int
    deadline: int
    assigned: bool = False
    done: bool = False
    outage: bool = False
    source: str | None = None


@dataclass
class CraneState:
    xy: Point
    available: bool
    active: Option | None = None
    finish: int = 0
    began: int = 0
    aborted: bool = False
    phase: str = ""
    decision: str = ""
    tray_began: int = 0
    tray_leg_kwh: float = 0
    busy_s: int = 0
    uptime_s: int = 0
    since: int = 0


@dataclass
class Outcome:
    task: Task
    option: Option
    time: int


def percentile(samples: list[int], fraction: float) -> float:
    return sorted(samples)[max(0, ceil(len(samples) * fraction) - 1)] if samples else 0.0


@dataclass
class Simulator:
    scenario: Scenario
    policy: Policy
    id: str
    cancelled: Callable[[], bool] = lambda: False
    events: list[Event] = field(default_factory=list, init=False)
    decisions: list[Decision] = field(default_factory=list, init=False)
    outcomes: list[Outcome] = field(default_factory=list, init=False)

    def __post_init__(self):
        self.env = simpy.Environment()
        self.facility = self.scenario.facility
        self.slots = self.facility.slots()
        self.racks = {r.id: r for r in self.facility.racks}
        self.cranes = {c.id: c for c in self.facility.cranes}
        self.rack_cranes = {c.racks[0]: c.id for c in self.facility.cranes}
        self.state = {c.id: CraneState(self.facility.crane_home(c), c.available) for c in self.facility.cranes}
        self.work = {w.container.id: w for w in self.scenario.work}
        self.restrictions = {r.slot: r for r in self.facility.restrictions}
        self.blocked = {r.slot for r in self.facility.restrictions if r.blocked}
        self.inventory: dict[str, str] = {}
        self.occupancy: dict[str, str] = {}
        self.reservations: dict[str, str] = {}
        self.tasks: dict[str, Task] = {}
        self.overrides: dict[str, str] = {}
        self.notices = {}
        self.queue_changed = False
        self.forecast = {}
        self.risk: set[str] = set()
        self.breaches: set[str] = set()
        self.energy = 0.0
        self.tray_energy = 0.0
        self.solver_ms: list[float] = []
        self.solver_status: Counter[str] = Counter()
        self.peak = 0
        self.trigger = "scenario start"
        self._slot_cost = lru_cache(maxsize=12_000)(self._movement_cost)
        self._dwell = {w.container.id: dwell(w.container) for w in self.scenario.work}
        for w in self.scenario.work:
            if not w.initial_slot:
                continue
            slot = self.slots[w.initial_slot]
            issue = self.incompatible(w, slot)
            if issue or not any(reachable(c, w.container, slot) for c in self.cranes.values()):
                raise ValueError(f"Invalid initial inventory at {slot.id}: {issue or 'unreachable slot'}")
            self.inventory[w.container.id] = slot.id
            self.occupancy[slot.id] = w.container.id

    @property
    def now(self) -> int:
        return int(self.env.now)

    def event(self, kind: K, task=None, cid=None, slot=None, crane=None, **data):
        version = len(self.events) + 1
        self.events.append(Event(
            id=f"E{version:06}", t=self.now, version=version, kind=kind,
            task=task, container=cid, slot=slot, crane=crane, data=data,
        ))
        if kind in (K.ARRIVAL, K.PICKUP, K.TASK_COMPLETED, K.FAILED, K.RECOVERED, K.BLOCKED, K.VESSEL, K.OVERRIDE):
            self.trigger = self.events[-1].id

    def incompatible(self, work: Work, slot: Slot) -> str | None:
        restriction = self.restrictions.get(slot.id)
        if slot.id in self.blocked or not self.racks[slot.rack].available:
            return "Storage is blocked"
        if restriction and restriction.reserve_for and restriction.reserve_for not in (
            work.container.id, work.container.carrier,
        ):
            return "Storage is reserved"
        issue = compatibility(work.container, slot)
        if issue:
            return issue
        if work.container.hazard:
            neighbors = [(self.slots[k], self.work[v].container)
                         for allocation in (self.occupancy, self.reservations) for k, v in allocation.items()]
            if segregation(self.facility, work.container, slot, neighbors):
                return "Hazard segregation policy"
        return None

    def _movement_cost(self, crane_id, xy, source, target, gross_kg):
        return movement(self.cranes[crane_id], xy, source, target, gross_kg)

    def forecast_update(self):
        self.forecast = workload_forecast(self.scenario, self.notices, self.now)
        self.event(K.FORECAST, **self.forecast)
        self.queue_changed = True

    def schedule(self, at: int, action, *args):
        def deferred():
            yield self.env.timeout(max(0, at - self.now))
            action(*args)
        self.env.process(deferred())

    def enqueue(self, w: Work, kind: str):
        if kind == "pickup" and self.now < w.container.hold_until_s:
            self.schedule(w.container.hold_until_s, self.unhold, w.container.id)
        task_id = f"{w.container.id}-{kind}"
        window = self.facility.operations.service_window_s
        if self.scenario.id == "priority" and w.container.priority >= 4:
            window = min(window, 165)
        deadline = w.deadline_s if kind == "pickup" and w.deadline_s is not None else self.now + (
            window if kind == "pickup" else 2 * window
        )
        self.tasks[task_id] = Task(task_id, w, kind, self.now, deadline)
        self.queue_changed = True
        self.event(K.PICKUP if kind == "pickup" else K.ARRIVAL, task_id, w.container.id,
                   carrier=w.container.carrier, deadline_s=deadline, priority=w.container.priority)
        if kind == "pickup" and (slot := self.inventory.get(w.container.id)):
            crane = self.rack_cranes[self.slots[slot].rack]
            if not self.state[crane].available:
                self.pickup_waiting(self.tasks[task_id], slot, crane)
        self.schedule(max(self.now, deadline - 85), self.sla_check, task_id)
        self.schedule(deadline + 1, self.sla_check, task_id)

    def pickup_waiting(self, task: Task, slot: str, crane: str):
        task.outage = True
        self.event(K.PICKUP_WAITING, task.key, task.work.container.id, slot, crane, deadline_s=task.deadline)

    def unhold(self, cid):
        self.queue_changed = True

    def sla_check(self, key):
        task = self.tasks[key]
        if task.done or task.kind != "pickup":
            return
        if key not in self.risk:
            self.risk.add(key)
            self.event(K.RISK, key, task.work.container.id, deadline_s=task.deadline)
        if self.now > task.deadline and key not in self.breaches:
            self.breaches.add(key)
            self.event(K.BREACH, key, task.work.container.id, deadline_s=task.deadline,
                       breakdown_exposure=task.outage)

    def vessel_notice(self, vessel):
        self.notices[vessel.id] = vessel
        if vessel.id == "VSL-01":
            self.notices.pop("VSL-00", None)
        self.event(K.VESSEL, **vessel.model_dump(mode="json"))
        self.forecast_update()
        self.queue_changed = True

    def intervention(self, i):
        if i.kind == "failure":
            state = self.state[i.target]
            if not state.available:
                return
            state.uptime_s += self.now - state.since
            state.available = False
            self.event(K.FAILED, crane=i.target)
            if (option := state.active) and state.phase != "tray-out" and not state.aborted:
                task = self.tasks[option.task]
                task.outage = True
                state.aborted = True
                plan = option.handling
                elapsed = max(0, self.now - state.began - plan.lift_start) if state.phase == "crane" else 0
                energy = plan.lift.kwh * elapsed / plan.lift.seconds
                self.energy += energy
                state.busy_s += elapsed
                self.event(K.SUSPENDED if state.phase == "crane" else K.HANDLING_CANCELLED,
                           task.key, option.container, option.slot, i.target,
                           energy_kwh=energy, origin=state.xy, rack=self.slots[option.slot].rack, decision=state.decision,
                           loaded_on_tray=option.kind == "store")
            for task in self.tasks.values():
                slot = self.inventory.get(task.work.container.id)
                if not task.done and task.kind == "pickup" and slot and self.rack_cranes[self.slots[slot].rack] == i.target:
                    self.pickup_waiting(task, slot, i.target)
        elif i.kind == "recovery":
            state = self.state[i.target]
            if state.available:
                return
            state.available, state.since = True, self.now
            self.event(K.RECOVERED, crane=i.target)
        elif i.kind == "block":
            if i.target in self.reservations or any(
                state.active and (state.active.slot == i.target or self.inventory.get(state.active.container) == i.target)
                for state in self.state.values()
            ):
                self.event(K.REJECTED, slot=i.target, reason="Destination is reserved by an executing movement")
                return
            self.blocked.add(i.target)
            self.event(K.BLOCKED, slot=i.target)
        elif i.kind == "unblock":
            self.blocked.discard(i.target)
            self.event(K.UNBLOCKED, slot=i.target)
        else:
            self.event(K.OVERRIDE, cid=i.target, slot=i.slot)
            task = self.tasks.get(f"{i.target}-store")
            if task and (task.assigned or task.done):
                self.event(K.REJECTED, cid=i.target, slot=i.slot, reason="Placement already committed")
                return
            self.overrides[i.target] = i.slot
        self.queue_changed = True

    def handling(self, crane: Crane, task: Task, slot: Slot) -> HandlingPlan:
        handoff = self.facility.handoff(slot)
        xy = self.state[crane.id].xy
        weight = task.work.container.gross_kg
        if task.kind == "relocate":
            source, dest = self.slots[task.source].xyz, slot.xyz
            return HandlingPlan(self._slot_cost(crane.id, xy, source, dest, weight), source, dest)
        route = self.facility.tray_route(slot)
        pickup = task.kind == "pickup"
        source, dest = (slot.xyz, handoff) if pickup else (handoff, slot.xyz)
        return HandlingPlan(
            self._slot_cost(crane.id, xy, source, dest, weight), source, dest, route,
            tray_leg(self.facility.tray, route, 0 if pickup else weight),
            tray_leg(self.facility.tray, route, weight if pickup else 0),
        )

    def options(self, task, available):
        cid = task.work.container.id
        w = task.work
        rejected: Counter[str] = Counter()
        options: list[Option] = []
        prediction = self._dwell[cid] if task.kind in ("store", "relocate") else {}
        if task.kind == "pickup":
            slot = self.inventory.get(cid)
            if not slot or self.now < w.container.hold_until_s or any(
                state.active and state.active.container == cid for state in self.state.values()
            ):
                return [], {"Awaiting storage or hold release": 1}, prediction
            slots = [self.slots[slot]]
        else:
            if task.kind == "relocate" and (self.inventory.get(cid) != task.source or
                                            (pickup := self.tasks.get(f"{cid}-pickup")) and not pickup.done):
                return [], {"Pickup is already released or source custody changed": 1}, prediction
            slots = list(self.slots.values())
        for slot in slots:
            if task.kind == "pickup" and (slot.id in self.blocked or not self.racks[slot.rack].available):
                rejected["Storage area unavailable"] += 1
                continue
            if task.kind != "pickup":
                issue = self.incompatible(w, slot)
                if issue or slot.id in self.occupancy or slot.id in self.reservations:
                    rejected[issue or "Occupied or reserved by another task"] += 1
                    continue
            source_slot = self.slots[task.source] if task.source else None
            for crane in available:
                if not reachable(crane, w.container, slot, *([source_slot] if source_slot else [])):
                    rejected["Dedicated rack crane or load limit"] += 1
                    continue
                plan = self.handling(crane, task, slot)
                tray_energy = sum(leg.kwh for leg in (plan.to_rack, plan.from_rack) if leg)
                move = replace(
                    plan.lift, seconds=plan.lift_end + (plan.from_rack.seconds if plan.from_rack else 0),
                    kwh=plan.lift.kwh + tray_energy,
                )
                if task.kind == "pickup" and w.hard and self.now + move.seconds > task.deadline:
                    rejected["Hard pickup cutoff cannot be met"] += 1
                    continue
                future, tier = 0, 0
                factors = None
                if prediction:
                    pressure = self.forecast.get("inbound_requests", 8) / max(1, len(self.slots) * 0.24)
                    appointment = w.container.appointment_s
                    soon = (max(0, appointment - self.now) < 1450 if appointment is not None
                            else prediction["days"] < 1.8)
                    travel_back = self._slot_cost(
                        crane.id, self.facility.handoff(slot), slot.xyz, self.facility.handoff(slot),
                        w.container.gross_kg,
                    ).seconds + sum(leg.seconds for leg in (plan.to_rack, plan.from_rack) if leg)
                    retrieval_cost = round(travel_back * (1.7 if soon else 0.27))
                    # Preserve scarce near-interface positions for the predicted wave.
                    near_interface_cost = 0 if soon else round(min(6, pressure) * 46 * max(0, 4 - slot.bay))
                    powered_slot_cost = round(min(5, pressure) * 68) if slot.reefer and w.container.cargo != "reefer" else 0
                    future = retrieval_cost + near_interface_cost + powered_slot_cost
                    if task.kind == "store" and self.policy == "predictive":
                        factors = PlacementFactors(soon, retrieval_cost, near_interface_cost, powered_slot_cost)
                    target_tier = 1 if prediction["days"] < 3 else 2 if prediction["days"] < 7 else 3
                    tier = 200 * abs(slot.level - min(target_tier, self.racks[slot.rack].levels))
                if task.kind == "relocate":
                    if source_slot is None:
                        raise RuntimeError("Relocation requires source custody")
                    old = self.handling(crane, Task(task.key, w, "pickup", self.now, task.deadline), source_slot)
                    new = self.handling(crane, Task(task.key, w, "pickup", self.now, task.deadline), slot)
                    old_legs = (old.lift, old.to_rack, old.from_rack)
                    new_legs = (new.lift, new.to_rack, new.from_rack)
                    net = sum(leg.seconds for leg in old_legs if leg) - sum(leg.seconds for leg in new_legs if leg)
                    net -= move.seconds + round(self.facility.operations.energy_weight * (
                        move.kwh + sum(leg.kwh for leg in new_legs if leg) - sum(leg.kwh for leg in old_legs if leg)
                    ))
                    if net <= 10:
                        rejected["No-action has better estimated net cost"] += 1
                        continue
                    future = -net
                options.append(Option(
                    task.key, cid, crane.id, slot.id, (f"crane:{crane.id}", f"rack:{slot.rack}"),
                    move, task.deadline, w.hard and task.kind == "pickup", w.container.priority,
                    self.now - task.created, task.kind, future, tier, factors, plan,
                ))
        return options, dict(rejected), prediction

    def compact(self, option):
        return {
            "slot": option.slot, "crane": option.crane, "seconds": option.movement.seconds,
            "kwh": round(option.movement.kwh, 5),
            "kg_co2e": round(option.movement.kwh * self.facility.grid_kg_per_kwh, 5),
            "future_cost": option.future_cost if self.policy == "predictive" else None,
            **({"placement_factors": asdict(option.placement_factors)} if option.placement_factors else {}),
            "cost": option.cost(self.policy, self.facility.operations.energy_weight),
            "slack_s": option.deadline - self.now - option.movement.seconds,
            **({"crane_seconds": option.handling.lift.seconds,
                "tray_seconds": sum(leg.seconds for leg in (option.handling.to_rack, option.handling.from_rack) if leg),
                "tray_kwh": round(sum(leg.kwh for leg in (option.handling.to_rack, option.handling.from_rack) if leg), 5)}
               if option.handling else {}),
        }

    def dispatch(self):
        if self.cancelled():
            raise InterruptedError("Cancelled simulation")
        available = [c for c in self.cranes.values() if self.state[c.id].available and self.state[c.id].active is None]
        pending = [t for t in self.tasks.values() if not t.assigned and not t.done]
        self.peak = max(self.peak, len([t for t in self.tasks.values() if not t.done and t.kind != "relocate"]))
        if not available or not pending:
            return
        if self.policy in ("fifo", "legacy"):
            ordered = sorted(pending, key=lambda t: (t.created, t.key))
        else:
            ordered = sorted(pending, key=lambda t: (
                -((self.now - t.created) * 2 + t.work.container.priority * 75
                  + (max(0, 480 - (t.deadline - self.now)) if t.kind == "pickup" else 0)), t.key,
            ))
        batch = self.facility.operations.max_batch
        busy = [
            (start, end, resources)
            for s in self.state.values() if s.active is not None
            for start, end, resources in s.active.reservations(s.began) if end > self.now
        ]
        options = []
        evidence = {}
        ready = 0
        used_racks = set()
        for task in ordered:
            if ready >= batch:
                break
            matched, rejected, prediction = self.options(task, available)
            if not matched:
                if task.kind == "relocate":
                    task.done = True
                    self.event(K.OPTIMIZED, task.key, task.work.container.id,
                               status="NO_ACTION", rejected=rejected)
                override = self.overrides.get(task.work.container.id)
                if override and task.kind == "store":
                    self.overrides.pop(task.work.container.id)
                    self.event(K.REJECTED, task.key, task.work.container.id, override,
                               reason="No safe placement with current inventory and equipment")
                continue
            if task.kind != "relocate":
                ready += 1
            weight = self.facility.operations.energy_weight
            ranked = sorted(matched, key=lambda o: (o.slot, o.crane) if self.policy == "fifo" else (
                o.cost(self.policy, weight), o.slot, o.crane,
            ))
            evidence[task.key] = (ranked, rejected, prediction)
            if task.kind == "store" and (override := self.overrides.get(task.work.container.id)):
                forced = [o for o in ranked if o.slot == override]
                if forced:
                    ranked = forced
                else:
                    self.overrides.pop(task.work.container.id)
                    self.event(K.REJECTED, task.key, task.work.container.id, override,
                               reason="Slot violates availability, occupancy, compatibility or reach rules")
            # Keep alternatives across each crane/rack pair so sharing can be optimized.
            used_racks.clear()
            for option in ranked:
                pair = (option.crane, self.slots[option.slot].rack)
                if pair not in used_racks:
                    options.append(option)
                    used_racks.add(pair)
            # Extra candidates allow concurrent choice when the same slot ranks first.
            options.extend(o for o in ranked[:2] if o not in options)
        if not options:
            return
        chosen, status, elapsed = build_plan(self.facility, self.policy, options, busy, self.now, batch)
        self.solver_ms.append(elapsed)
        self.solver_status[status] += 1
        self.event(K.OPTIMIZED, status=status, candidate_count=len(options), dispatched=len(chosen),
                   pending=len(pending))
        for option in sorted(chosen, key=lambda o: (o.crane, o.task)):
            # The CP model excludes simultaneous destinations, but segregation
            # also depends on neighboring cargo reserved earlier in this commit.
            task = self.tasks[option.task]
            if option.kind != "pickup" and self.incompatible(task.work, self.slots[option.slot]):
                continue
            ranked, rejected, prediction = evidence[option.task]
            override = None
            if option.kind == "store" and self.overrides.get(option.container) == option.slot:
                self.overrides.pop(option.container)
                original = self.compact(ranked[0])
                actual = self.compact(option)
                override = {
                    "recommended": original, "selected": actual, "feasible": True,
                    "delta_seconds": actual["seconds"] - original["seconds"],
                    "delta_kwh": actual["kwh"] - original["kwh"],
                }
                self.event(K.APPLIED, option.task, option.container, option.slot, option.crane, **override)
            record = Decision(
                id=f"D{len(self.decisions) + 1:05}", t=self.now, state_version=len(self.events),
                trigger=self.trigger, task=option.task, container=option.container, action=option.kind,
                status=status, candidate_count=len(ranked), rejected=rejected, selected=self.compact(option),
                alternatives=[self.compact(x) for x in ranked if x != option][:4],
                prediction={"pickup": prediction, "workload": self.forecast} if self.policy == "predictive" else {},
                model_version=model_version(), override=override,
            )
            self.decisions.append(record)
            self.start(option, record.id)

    def relocation_review(self):
        if self.policy != "predictive":
            return
        pending = any(not t.done for t in self.tasks.values())
        if pending:
            self.event(K.OPTIMIZED, status="NO_ACTION", reason="Relocation would compete with released work")
            return
        # Inspect a bounded set of known appointments. No actual pickup time is read.
        future = sorted(
            (w for cid, w in self.work.items() if cid in self.inventory and w.container.appointment_s
             and self.now + 240 < w.container.appointment_s <= self.now + 1000
             and not w.container.hold_until_s > self.now),
            key=lambda w: (w.container.appointment_s, w.container.id),
        )
        if not future:
            self.event(K.OPTIMIZED, status="NO_ACTION", reason="No near-term booked pickup justifies review")
            return
        w = future[0]
        cid = w.container.id
        key = f"{cid}-relocate"
        if key not in self.tasks:
            self.tasks[key] = Task(key, w, "relocate", self.now, w.container.appointment_s, source=self.inventory[cid])
            self.queue_changed = True

    def start(self, option: Option, decision: str):
        task = self.tasks[option.task]
        state = self.state[option.crane]
        plan = option.handling
        task.assigned = True
        state.active = option
        state.began = self.now
        state.finish = self.now + option.movement.seconds
        state.aborted = False
        state.decision = decision
        if option.kind != "pickup":
            self.reservations[option.slot] = option.container
            self.event(K.RESERVED, option.task, option.container, option.slot, option.crane)
        self.event(K.ASSIGNED, option.task, option.container, option.slot, option.crane,
                   decision=decision, finish_s=state.finish, resources=option.resources)
        if plan.to_rack:
            self.start_tray(option, decision, inbound=True)
            self.schedule(self.now + plan.lift_start, self.at_handoff, option, decision)
        else:
            self.start_lift(option, decision)
        self.schedule(state.began + plan.lift_end, self.at_lift_end, option, decision)
        self.schedule(state.finish, self.complete, option, decision)

    def start_tray(self, option: Option, decision: str, *, inbound: bool):
        state = self.state[option.crane]
        plan = option.handling
        route = plan.route if inbound else tuple(reversed(plan.route))
        loaded = (option.kind == "store") if inbound else (
            option.kind == "pickup" and not state.aborted or option.kind == "store" and state.aborted
        )
        leg = plan.to_rack if inbound else tray_leg(
            self.facility.tray, route, self.work[option.container].container.gross_kg if loaded else 0,
        )
        state.phase = "tray-in" if inbound else "tray-out"
        state.tray_began = self.now
        state.tray_leg_kwh = leg.kwh
        self.event(K.TRAY_STARTED, option.task, option.container, option.slot, option.crane,
                   decision=decision, tray=f"TRAY-{self.slots[option.slot].rack}", loaded=loaded,
                   path=route, finish_s=self.now + leg.seconds, direction="to_rack" if inbound else "to_interface")

    def finish_tray(self, option: Option, decision: str, *, inbound: bool, loaded: bool):
        state = self.state[option.crane]
        self.tray_energy += state.tray_leg_kwh
        self.event(K.TRAY_ARRIVED, option.task, option.container, option.slot, option.crane,
                   decision=decision, tray=f"TRAY-{self.slots[option.slot].rack}", loaded=loaded,
                   xyz=option.handling.route[-1 if inbound else 0], energy_kwh=state.tray_leg_kwh,
                   direction="to_rack" if inbound else "to_interface")
        state.tray_leg_kwh = 0

    def at_handoff(self, option: Option, decision: str):
        state = self.state[option.crane]
        self.finish_tray(option, decision, inbound=True, loaded=option.kind == "store")
        if state.aborted:
            state.phase = "waiting-return"
            return
        if option.kind == "store":
            self.event(K.HANDOFF, option.task, option.container, option.slot, option.crane,
                       decision=decision, direction="tray_to_crane", xyz=option.handling.source,
                       tray=f"TRAY-{self.slots[option.slot].rack}")
        self.start_lift(option, decision)

    def start_lift(self, option: Option, decision: str):
        state = self.state[option.crane]
        plan = option.handling
        state.phase = "crane"
        self.event(K.STARTED, option.task, option.container, option.slot, option.crane,
                   decision=decision, from_xyz=state.xy, source_xyz=plan.source, to_xyz=plan.destination,
                   finish_s=self.now + plan.lift.seconds, operation=option.kind)

    def at_lift_end(self, option: Option, decision: str):
        state = self.state[option.crane]
        plan = option.handling
        if not state.aborted:
            state.xy = plan.destination
            state.busy_s += plan.lift.seconds
            self.energy += plan.lift.kwh
            if option.kind in ("pickup", "relocate"):
                source = self.inventory.pop(option.container)
                self.occupancy.pop(source)
                self.event(K.RELEASED, option.task, option.container, source, option.crane)
            if option.kind != "pickup":
                self.reservations.pop(option.slot)
                self.inventory[option.container] = option.slot
                self.occupancy[option.slot] = option.container
                self.event(K.OCCUPIED, option.task, option.container, option.slot, option.crane)
            self.event(K.COMPLETED, option.task, option.container, option.slot, option.crane,
                       decision=decision, operation=option.kind, end_xyz=state.xy, energy=asdict(plan.lift))
            if option.kind == "pickup":
                self.event(K.HANDOFF, option.task, option.container, option.slot, option.crane,
                           decision=decision, direction="crane_to_tray", xyz=state.xy,
                           tray=f"TRAY-{self.slots[option.slot].rack}")
        if plan.from_rack:
            self.start_tray(option, decision, inbound=False)

    def complete(self, option: Option, decision: str):
        state = self.state[option.crane]
        task = self.tasks[option.task]
        state.active = None
        state.phase = ""
        if option.handling.from_rack:
            self.finish_tray(option, decision, inbound=False,
                             loaded=option.kind == ("store" if state.aborted else "pickup"))
        if state.aborted:
            task.assigned = False
            self.reservations.pop(option.slot, None)
            self.event(K.HANDLING_CANCELLED, option.task, option.container, option.slot, option.crane,
                       decision=decision, reservation_released=option.kind != "pickup", retry=True)
        else:
            task.done = True
            self.outcomes.append(Outcome(task, option, self.now))
            self.event(K.TASK_COMPLETED, option.task, option.container, option.slot, option.crane,
                       decision=decision, operation=option.kind, wait_s=self.now - task.created,
                       deadline_s=task.deadline, late=self.now > task.deadline, teu=task.work.container.teu)
        self.queue_changed = True

    def run(self) -> Run:
        started = perf_counter()
        self.forecast_update()
        for vessel in self.scenario.vessels:
            self.schedule(vessel.notice_s, self.vessel_notice, vessel)
        for w in self.scenario.work:
            if w.initial_slot is None:
                self.schedule(w.release_s, self.enqueue, w, "store")
            if w.pickup_s is not None:
                self.schedule(w.pickup_s, self.enqueue, w, "pickup")
        for i in self.scenario.interventions:
            self.schedule(i.at_s, self.intervention, i)
        for at in range(180, self.scenario.horizon_s, 240):
            self.schedule(at, self.forecast_update)
            self.schedule(at, self.relocation_review)
        while self.env.peek() <= self.scenario.horizon_s:
            if self.cancelled():
                raise InterruptedError("Cancelled simulation")
            now = self.env.peek()
            self.env.step()
            if self.env.peek() != now and self.queue_changed:
                self.queue_changed = False
                self.dispatch()
        if self.now < self.scenario.horizon_s:
            self.env.run(until=self.scenario.horizon_s)
        self.event(K.FINISHED, backlog=sum(not t.done and t.kind != "relocate" for t in self.tasks.values()))
        self._slot_cost.cache_clear()
        return Run(
            id=self.id, policy=self.policy, scenario=self.scenario, slots=list(self.slots.values()),
            model_version=model_version(), events=self.events, decisions=self.decisions, metrics=self.metrics(),
            elapsed_ms=(perf_counter() - started) * 1000, solver_ms=self.solver_ms,
        )

    def metrics(self) -> Metrics:
        pickups = [o for o in self.outcomes if o.task.kind == "pickup"]
        waits = [o.time - o.task.created for o in pickups]
        late = [max(0, o.time - o.task.deadline) for o in pickups]
        late.extend(self.now - t.deadline for t in self.tasks.values()
                    if t.kind == "pickup" and not t.done and self.now > t.deadline)
        late_count = sum(x > 0 for x in late)
        due = sum(t.kind == "pickup" and (t.done or t.deadline < self.now) for t in self.tasks.values())
        utilization, idle, motion, tray = {}, 0.0, self.energy, self.tray_energy
        for cid, s in self.state.items():
            uptime = s.uptime_s + (self.now - s.since if s.available else 0)
            partial = 0
            if s.active is not None:
                plan = s.active.handling
                if s.phase == "crane" and not s.aborted:
                    partial = self.now - s.began - plan.lift_start
                    motion += plan.lift.kwh * partial / plan.lift.seconds
                elif s.phase in ("tray-in", "tray-out"):
                    leg = plan.to_rack if s.phase == "tray-in" else plan.from_rack
                    tray += s.tray_leg_kwh * (self.now - s.tray_began) / leg.seconds
            busy = s.busy_s + partial
            utilization[cid] = round(100 * busy / uptime, 3) if uptime else 0.0
            idle += self.cranes[cid].idle_kw * max(0, uptime - busy) / 3600
        motion += tray
        kwh = motion + idle
        co2e = kwh * self.facility.grid_kg_per_kwh
        service_moves = [o for o in self.outcomes if o.option.kind != "relocate"]
        moves = len(service_moves)
        teu = sum(o.task.work.container.teu for o in service_moves)
        return Metrics(
            moves=moves, pickups=len(pickups), teu=teu, moves_per_hour=moves * 3600 / self.now,
            on_time_pct=100 * (due - late_count) / due if due else 100, late=late_count, at_risk=len(self.risk),
            breakdown_breaches=sum(o.task.outage and o.time > o.task.deadline for o in pickups)
            + sum(t.outage and not t.done and t.deadline < self.now for t in self.tasks.values() if t.kind == "pickup"),
            pickup_wait_s=mean(waits) if waits else 0, p95_wait_s=percentile(waits, 0.95),
            mean_late_s=mean([x for x in late if x]) if any(late) else 0,
            p95_late_s=percentile([x for x in late if x], 0.95), kwh=kwh, motion_kwh=motion,
            tray_kwh=tray, idle_kwh=idle, kg_co2e=co2e, kwh_per_move=kwh / moves if moves else 0,
            kwh_per_teu=kwh / teu if teu else 0, co2e_per_move=co2e / moves if moves else 0,
            co2e_per_teu=co2e / teu if teu else 0,
            backlog=sum(not t.done and t.kind != "relocate" for t in self.tasks.values()),
            initial_inventory=sum(w.initial_slot is not None for w in self.scenario.work),
            ending_inventory=len(self.inventory), peak_backlog=self.peak,
            placements=dict(Counter(self.slots[o.option.slot].rack for o in service_moves if o.option.kind == "store")),
            crane_utilization=utilization, waits_s=waits, solver_status=dict(self.solver_status),
        )
