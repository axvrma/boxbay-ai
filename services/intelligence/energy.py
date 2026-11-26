"""Authoritative movement time and electrical energy in seconds and kWh."""
from dataclasses import dataclass
from math import ceil, hypot

from .domain import Crane, Point, TraySystem


@dataclass(frozen=True)
class Movement:
    seconds: int
    horizontal_m: float
    vertical_m: float
    lift_kwh: float
    regen_kwh: float
    traction_kwh: float
    auxiliary_kwh: float
    kwh: float


def movement(crane: Crane, start: Point, source: Point, destination: Point, kg: float) -> Movement:
    empty_m = hypot(start[0] - source[0], start[2] - source[2])
    load_m = hypot(source[0] - destination[0], source[2] - destination[2])
    empty_dy = source[1] - start[1]
    load_dy = destination[1] - source[1]
    vertical_m = abs(empty_dy) + abs(load_dy)
    horizontal_m = empty_m + load_m
    seconds = ceil(horizontal_m / crane.travel_mps + vertical_m / crane.hoist_mps + crane.handling_s)
    lift, regen = 0.0, 0.0
    for delta, mass in ((empty_dy, crane.tare_kg), (load_dy, crane.tare_kg + kg)):
        potential = mass * 9.80665 * abs(delta) / 3_600_000
        if delta > 0:
            lift += potential / crane.lift_efficiency
        else:
            regen += potential * crane.regeneration
    traction = crane.traction_kwh_per_m * (empty_m + load_m * (1 + kg / 100_000))
    aux = crane.aux_kw * seconds / 3600
    return Movement(seconds, horizontal_m, vertical_m, lift, regen, traction, aux, max(0, lift + traction + aux - regen))


@dataclass(frozen=True)
class TrayLeg:
    seconds: int
    kwh: float


def tray_leg(system: TraySystem, route: tuple[Point, ...], kg: float) -> TrayLeg:
    distance = sum(hypot(a[0] - b[0], a[2] - b[2]) for a, b in zip(route, route[1:]))
    return TrayLeg(
        ceil(distance / system.speed_mps) + system.docking_s,
        distance * (system.empty_kwh_per_m + kg / 1000 * system.load_kwh_per_tonne_m),
    )
