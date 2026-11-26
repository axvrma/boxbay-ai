"""Bounded rolling-horizon CP-SAT assignment and sequencing."""
from collections import defaultdict
from dataclasses import dataclass
from time import perf_counter

from ortools.sat.python import cp_model

from .domain import Facility, Point, Policy
from .energy import Movement, TrayLeg


@dataclass(frozen=True)
class PlacementFactors:
    pickup_soon: bool
    retrieval_cost: int
    near_interface_cost: int
    powered_slot_cost: int


@dataclass(frozen=True)
class HandlingPlan:
    lift: Movement
    source: Point
    destination: Point
    route: tuple[Point, ...] = ()
    to_rack: TrayLeg | None = None
    from_rack: TrayLeg | None = None

    @property
    def lift_start(self) -> int:
        return self.to_rack.seconds if self.to_rack else 0

    @property
    def lift_end(self) -> int:
        return self.lift_start + self.lift.seconds

    def transfer_windows(self) -> tuple[tuple[int, int], ...]:
        if self.to_rack and self.from_rack:
            # Keep distinct scheduled legs from starting while another is
            # still committing its arrival at the same simulation second.
            return ((0, self.to_rack.seconds + 1), (self.lift_end, self.from_rack.seconds + 1))
        return ()


@dataclass(frozen=True)
class Option:
    task: str
    container: str
    crane: str
    slot: str
    resources: tuple[str, ...]
    movement: Movement
    deadline: int
    hard: bool
    priority: int
    wait: int
    kind: str
    future_cost: int = 0
    tier_cost: int = 0
    placement_factors: PlacementFactors | None = None
    handling: HandlingPlan | None = None

    def reservations(self, start: int):
        yield start, start + self.movement.seconds, self.resources
        if self.handling:
            for offset, duration in self.handling.transfer_windows():
                yield start + offset, start + offset + duration, ("transfer",)

    def cost(self, policy: Policy, energy_weight: float) -> int:
        energy = round(self.movement.kwh * energy_weight)
        if policy == "legacy":
            return self.tier_cost + round(self.movement.kwh * 100)
        return self.movement.seconds + energy + (self.future_cost if policy == "predictive" else 0)


def build_plan(
    facility: Facility, policy: Policy, options: list[Option], busy: list[tuple[int, int, tuple[str, ...]]],
    now: int, batch_limit: int,
) -> tuple[list[Option], str, float]:
    started = perf_counter()
    energy_weight = facility.operations.energy_weight

    def greedy(ordered):
        reservations = list(busy)
        result: list[Option] = []
        for option in ordered:
            if len(result) >= batch_limit:
                break
            windows = list(option.reservations(now))
            if any(
                start < other_end and other_start < end and set(resources).intersection(other_resources)
                for start, end, resources in windows
                for other_start, other_end, other_resources in reservations
            ):
                continue
            if any(x.task == option.task or x.slot == option.slot for x in result):
                continue
            if option.hard and now + option.movement.seconds > option.deadline:
                continue
            result.append(option)
            reservations.extend(windows)
        return result

    if policy in ("fifo", "legacy"):
        proposed = sorted(options, key=lambda o: (
            -o.wait, o.task, o.cost(policy, energy_weight) if policy == "legacy" else 0, o.slot, o.crane,
        ))
        return greedy(proposed), "HEURISTIC", (perf_counter() - started) * 1000
    if not options:
        return [], "NO_FEASIBLE_CANDIDATES", 0.0

    model = cp_model.CpModel()
    horizon = 5400
    resource_intervals = defaultdict(list)
    tasks = defaultdict(list)
    destinations = defaultdict(list)
    choices = []
    scores = []
    for index, (start_at, end_at, resources) in enumerate(busy):
        interval = model.new_fixed_size_interval_var(max(0, start_at - now),
                                                     end_at - max(now, start_at), f"busy-{index}")
        for resource in resources:
            resource_intervals[resource].append(interval)
    for index, option in enumerate(options):
        take = model.new_bool_var(f"take-{index}")
        duration = option.movement.seconds
        start = model.new_int_var(0, horizon, f"start-{index}")
        late = model.new_int_var(0, 90_000, f"late-{index}")
        interval = model.new_optional_fixed_size_interval_var(start, duration, take, f"move-{index}")
        model.add(start == 0).only_enforce_if(take.Not())
        model.add(late >= now + start + duration - option.deadline).only_enforce_if(take)
        model.add(late == 0).only_enforce_if(take.Not())
        if option.hard:
            model.add(late == 0).only_enforce_if(take)
        for resource in option.resources:
            resource_intervals[resource].append(interval)
        if option.handling:
            for offset, leg_duration in option.handling.transfer_windows():
                tray = model.new_optional_fixed_size_interval_var(start + offset, leg_duration, take, f"tray-{index}-{offset}")
                resource_intervals["transfer"].append(tray)
        tasks[option.task].append(take)
        destinations[option.slot].append(take)
        choices.append((option, take, start))
        service_value = 1400 + min(11_000, option.wait * 3) + 170 * option.priority
        if option.kind == "pickup":
            service_value += 450
        # Time and energy units are combined as policy-weighted second equivalents.
        scores.append(
            (service_value - option.cost(policy, energy_weight)) * take
            + (-(4 + option.priority)) * start + (-(12 + 2 * option.priority)) * late
        )
    for group in (*tasks.values(), *destinations.values()):
        model.add_at_most_one(group)
    for intervals in resource_intervals.values():
        model.add_no_overlap(intervals)
    model.add(sum(take for _, take, _ in choices) <= batch_limit)
    model.maximize(sum(scores))
    solver = cp_model.CpSolver()
    solver.parameters.num_search_workers = 1
    solver.parameters.max_deterministic_time = 0.0025
    solver.parameters.random_seed = 0
    status = solver.solve(model)
    name = solver.status_name(status)
    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        selected = [o for o, take, start in choices if solver.value(take) and solver.value(start) == 0]
        if selected:
            return selected, name, (perf_counter() - started) * 1000
    # A plan containing only future work is advisory. A deterministic fallback
    # preserves progress on current tasks without bypassing resource locks.
    ranked = sorted(options, key=lambda o: (
        -(4 * o.wait + 100 * o.priority + (400 if o.kind == "pickup" else 0))
        + o.cost(policy, energy_weight) + 12 * max(0, now + o.movement.seconds - o.deadline),
        o.task, o.slot, o.crane,
    ))
    return greedy(ranked), f"{name}_FALLBACK", (perf_counter() - started) * 1000
