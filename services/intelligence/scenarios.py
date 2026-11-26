"""Seeded, policy-blind workload fixtures for reproducible paired experiments."""
from random import Random

from .constraints import compatibility, reachable
from .domain import (
    Carrier, Container, Crane, Facility, Intervention, Rack, Restriction, Scenario, VesselRevision, VesselWorkload, Work,
)
from .forecasting import monthly

CATALOG = {
    "surge": ("Demand surge", "A published vessel notice makes the next inbound wave visible."),
    "unexpected": ("Unexpected inbound", "A larger wave arrives with very little warning."),
    "breakdown": ("Crane failure", "An outage holds pickups in the affected rack while the AI routes new arrivals to working racks."),
    "override": ("Operator override", "A safe alternate slot replaces the engine's recommendation."),
    "energy": ("Energy comparison", "Compare identical handling requests under different policies."),
    "normal": ("Normal operations", "Regular inbound flow and booked pickups."),
    "high-occupancy": ("High occupancy", "Limited storage headroom restricts feasible placements."),
    "multi-vessel": ("Simultaneous vessels", "Two external workload streams release at the same interface."),
    "late-vessel": ("Late vessel", "An updated vessel notice shifts the inbound wave."),
    "restricted": ("Restricted slots", "Blocked and reserved storage constrains assignment."),
    "priority": ("Priority pickups", "Tight pickup windows compete for shared resources."),
    "pickup-delay": ("Pickup uncertainty", "Carrier-specific delays shift appointment arrivals."),
    "forecast-error": ("Forecast error", "An overstated inbound forecast reserves capacity against demand that never arrives."),
    "topology": ("Changed topology", "Four racks have dedicated cranes, with two cranes unavailable throughout the run."),
}


def facility(racks: int = 3, online: int | None = None) -> Facility:
    rows = tuple(
        Rack(id=f"R{i + 1}", z=i * 19, hazards=("H1", "H2") if i == 0 else ())
        for i in range(racks)
    )
    equipment = tuple(
        Crane(
            id=f"CR-{i + 1:02}", racks=(row.id,), zone=f"AISLE-{i + 1}",
            travel_mps=2.7 + 0.35 * (i % 4), available=online is None or i < online,
        )
        for i, row in enumerate(rows)
    )
    return Facility(racks=rows, cranes=equipment)


def make_scenario(name: str, seed: int, topology: Facility | None = None) -> Scenario:
    rng = Random(seed)
    config = topology or (facility(4, 2) if name == "topology" else facility())
    if name == "energy" and topology is None:
        config = config.model_copy(update={
            "operations": config.operations.model_copy(update={"energy_weight": 125}),
        })
    slots = config.slots()
    available_racks = {rack.id for rack in config.racks if rack.available}
    if name == "restricted" and not config.restrictions:
        config = config.model_copy(update={"restrictions": tuple(
            Restriction(slot=id_, blocked=True, reason="Maintenance isolation") for id_ in list(slots)[::11][:9]
        )})
    slots_open = [
        s for s in slots.values() if s.rack in available_racks
        and all(r.slot != s.id or not r.blocked and r.reserve_for is None for r in config.restrictions)
    ]
    carriers = tuple(Carrier(id=f"C{i + 1:02}", on_time_probability=0.68 + 0.05 * i, mean_delay_s=160 - 18 * i)
                     for i in range(6))
    expected = 1040
    updated = {"late-vessel": 1730, "unexpected": 710}.get(name, expected)
    season_index = monthly("import", Scenario.model_fields["start"].default).get("seasonal_index", 1.0)
    wave = {
        "surge": 31, "unexpected": 27, "multi-vessel": 24, "late-vessel": 21, "forecast-error": 4,
    }.get(name, max(8, round(12 * season_index)))
    wave = min(wave, max(2, len(slots_open) // 2))
    vessels = [VesselWorkload(
        id="VSL-01", notice_s=0 if name != "unexpected" else 680,
        expected_s=expected, updated_s=updated, inbound_count=wave,
    )]
    if name == "late-vessel":
        vessels = [
            VesselWorkload(id="VSL-00", notice_s=0, expected_s=expected, updated_s=expected, inbound_count=wave),
            vessels[0].model_copy(update={"notice_s": 600}),
        ]
    if name == "multi-vessel":
        vessels.append(VesselWorkload(
            id="VSL-02", notice_s=370, expected_s=1110, updated_s=1055, inbound_count=wave // 2,
        ))

    def box(i: int, vessel: str | None = None, slot=None) -> Container:
        carrier = rng.choice(carriers)
        reefer = (slot is None or slot.reefer) and rng.random() < 0.12
        size = rng.choice(slot.sizes if slot else (20, 40, 40, 40, 45))
        gross_kg = rng.randrange(11_000, 31_000, 250)
        if slot:
            gross_kg = min(gross_kg, slot.max_kg)
        return Container(
            id=f"BX-{i + 1:04}", size_ft=size, gross_kg=gross_kg, carrier=carrier.id,
            cargo="reefer" if reefer else "dry", vessel=vessel,
            priority=5 if name == "priority" and i % 3 == 0 else (3 if i % 6 == 0 else 1),
            carrier_delay_days=carrier.mean_delay_s / 86400 + 0.17,
            appointment_lead_days=rng.uniform(0.2, 4.7), service_class=i % 3,
        )

    starting = min(150, int(len(slots_open) * (0.78 if name == "high-occupancy" else 0.34)))
    selected = rng.sample(slots_open, starting)
    work: list[Work] = []
    for i, slot in enumerate(selected):
        container = box(i, slot=slot)
        if compatibility(container, slot) or not any(reachable(c, container, slot) for c in config.cranes):
            continue
        booking = rng.randint(150, 2970) if i % 4 != 3 else None
        carrier = next(c for c in carriers if c.id == container.carrier)
        delay = round(rng.expovariate(1 / max(1, carrier.mean_delay_s))) if rng.random() > carrier.on_time_probability else 0
        if name == "pickup-delay":
            delay += rng.randrange(0, 800)
        work.append(Work(
            container=container.model_copy(update={"appointment_s": booking}), release_s=0, initial_slot=slot.id,
            pickup_s=booking + delay if booking is not None else None,
        ))

    waves: list[tuple[int, str | None]] = [(3 + i * 41, None) for i in range(min(18, max(1, len(slots_open) // 3)))]
    waves.extend((updated + rng.randrange(0, 460), "VSL-01") for _ in range(wave))
    if name == "multi-vessel":
        waves.extend((1055 + rng.randrange(0, 300), "VSL-02") for _ in range(wave // 2))
    waves.extend((rng.randrange(1900, 3400), None) for _ in range(min(14, len(slots_open) // 3)))
    for i, (release, vessel) in enumerate(sorted(waves, key=lambda wave: (wave[0], wave[1] or "")), start=starting):
        container = box(i, vessel)
        booking = release + rng.randrange(410, 2200) if i % 3 != 0 else None
        delay = rng.randrange(0, 550 if name == "pickup-delay" else 210)
        work.append(Work(
            container=container.model_copy(update={"appointment_s": booking}), release_s=release,
            pickup_s=booking + delay if booking is not None else None,
        ))
    interventions: list[Intervention] = []
    if name == "breakdown":
        for at, kind in ((60, "failure"), (495, "recovery"), (1000, "failure"), (1570, "recovery")):
            interventions.append(Intervention(at_s=at, kind=kind, target=config.cranes[0].id))
    if name == "override":
        inbound = next(w for w in work if w.initial_slot is None)
        unused = [s for s in reversed(slots_open) if s not in selected and not compatibility(inbound.container, s)
                  and any(c.available and reachable(c, inbound.container, s) for c in config.cranes)]
        if unused:
            interventions.append(Intervention(kind="override", at_s=0, target=inbound.container.id, slot=unused[0].id))
    return Scenario(
        id=name, name=CATALOG[name][0], seed=seed, facility=config, work=tuple(work),
        interventions=tuple(interventions), carriers=carriers, vessels=tuple(vessels),
        forecast_multiplier=4.0 if name == "forecast-error" else 1.0,
    )


def revise_vessel(config: Scenario, revision: VesselRevision) -> Scenario:
    """Reschedule unreleased boundary requests, preserving announced and realized pickup offsets."""
    if revision.notice_s > config.horizon_s or revision.estimated_arrival_s > config.horizon_s:
        raise ValueError("Vessel update is outside the run horizon")
    vessel = next((v for v in reversed(config.vessels) if v.id == revision.vessel), None)
    if vessel is None or revision.notice_s <= vessel.notice_s:
        raise ValueError("Vessel update must refer to a known vessel after its first notice")
    affected = sorted(
        (w for w in config.work if w.container.vessel == vessel.id and w.release_s >= revision.notice_s),
        key=lambda w: (w.release_s, w.container.id),
    )
    unaffected = [w for w in config.work if w not in affected]
    if revision.inbound_count > len(affected):
        raise ValueError("This editor reschedules or cancels planned requests. Use Unexpected inbound to add a wave.")
    if not affected:
        raise ValueError("No unreleased cargo remains for this vessel")
    updated = max(revision.notice_s, revision.estimated_arrival_s)
    offsets = [w.release_s - affected[0].release_s for w in affected]
    retained = affected[:revision.inbound_count]
    removed = {w.container.id for w in affected[len(retained):]}
    if any(i.kind == "override" and i.target in removed for i in config.interventions):
        raise ValueError("Remove placement overrides for canceled cargo first")
    revised = []
    for w, offset in zip(retained, offsets):
        release = updated + offset
        shift = release - w.release_s
        appointment = w.container.appointment_s
        revised.append(w.model_copy(update={
            "container": w.container.model_copy(update={
                "appointment_s": appointment + shift if appointment is not None else None,
            }),
            "release_s": release,
            "pickup_s": w.pickup_s + shift if w.pickup_s is not None else None,
            "deadline_s": w.deadline_s + shift if w.deadline_s is not None else None,
        }))
    update = vessel.model_copy(update={
        "notice_s": revision.notice_s, "updated_s": updated, "inbound_count": revision.inbound_count,
    })
    return Scenario.model_validate({
        **config.model_dump(), "work": [w.model_dump() for w in (*unaffected, *revised)],
        "vessels": [v.model_dump() for v in (*config.vessels, update)],
    })
