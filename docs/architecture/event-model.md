# Event schema and custody

An event has an increasing identifier and state version, simulation seconds, and optional task, container, crane and slot. Tray departure records the route, load state and finish time. A handoff identifies custody passing from tray to crane or back. Crane movement stays in one rack. Storage commits to the slot when the crane finishes. Pickup releases the slot when the crane transfers the load to the tray. Handling completes at the interface, including the empty tray return after storage.

An offline rack crane leaves stored pickups waiting for that crane. Affected inbound can return on its tray and requeue at the interface. Interruption of a lift uses an abstract local rollback and accrues partial crane energy. An outbound tray already returning to the interface can finish after the crane fails.

Audit decisions retain trigger event, evaluated candidates, constraint rejection counts, selected scores, pickup and demand predictions, override differences and solver outcome. Runtime timing measurements are separate from deterministic traces. State playback may restart or scrub at arbitrary times.
