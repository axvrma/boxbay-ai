# Discrete-event simulation

The SimPy scheduler groups events with the same simulated time and dispatches once the batch has applied. Work release, pickup, completion, notices, holds, due-time checks and interventions are scheduled inputs. Outages leave pickups in storage until the owning crane recovers. Interrupted inbound handling returns the container to the interface on its tray and releases the slot reservation before requeuing. Blocking a reserved or currently serviced location is rejected. Physical transfer recovery is abstracted and needs engineering validation before a pilot.

A given snapshot, model, policy and compatible OR-Tools build produces the same event and decision order. Runtime profiling is excluded from reproducibility checks. The browser accelerates or steps through the immutable event log. Save and restore persist scenario inputs and deterministic restart, with exact historic playback provided by the run artifact. There is no persistent in-flight SimPy process snapshot.

Model time uses integer seconds. KPI backlog includes started and queued demand. Completed moves exclude optional repositioning. SLA denominator includes completed pickups and overdue unfinished pickups. Wait P95 uses completed pickups only, so inspect backlog and SLA with waits. Crane utilization divides busy time by powered and available time.
