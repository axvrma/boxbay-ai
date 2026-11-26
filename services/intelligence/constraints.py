"""Shared feasibility rules for initial inventory, dispatch and overrides."""
from .domain import Container, Crane, Facility, Slot


def compatibility(container: Container, slot: Slot) -> str | None:
    if container.size_ft not in slot.sizes:
        return "Container length is incompatible"
    if container.gross_kg > slot.max_kg:
        return "Slot load limit exceeded"
    if container.cargo == "reefer" and not slot.reefer:
        return "Reefer connection required"
    if container.hazard and container.hazard not in slot.hazards:
        return "Hazard class is excluded from this slot"
    if container.cargo == "oog" and not slot.oog_allowed:
        return "Out-of-gauge cargo is excluded"
    return None


def reachable(crane: Crane, container: Container, *slots: Slot) -> bool:
    return crane.max_kg >= container.gross_kg and all(crane.racks == (slot.rack,) for slot in slots)


def segregation(
    facility: Facility, container: Container, slot: Slot, neighbors: list[tuple[Slot, Container]],
) -> bool:
    return bool(container.hazard and any(
        other.hazard and other.hazard != container.hazard and loc.rack == slot.rack
        and abs(loc.bay - slot.bay) < facility.operations.hazard_separation_bays
        for loc, other in neighbors
    ))
