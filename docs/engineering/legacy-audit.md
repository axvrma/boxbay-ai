# Legacy audit

Audit baseline is repository commit `0f240aa`. The original CRA dashboard, Express orchestrator, Python dwell service and Unity 6000.3 prototype remain at their original paths for reproducibility. The new deployment excludes them. This was a static source and artifact audit, including Unity C# and scene declarations.

| Area | Behavior verified | Migration |
| --- | --- | --- |
| Node / SQLite | `gridState.js` initializes two fixed 5×3 grids in memory, while the database separately stores slots, containers, moves and energy. Inbound writes cross those representations. Only SQLite WAL/SHM sidecars are tracked. | Derive one run from a versioned facility and input event stream. Store complete run evidence in a transaction. Start with synthetic inventory. |
| Container lifecycle | The inbound controller occupies slots at dispatch. The outbound route releases slots without a completion acknowledgement. GPS dispatch and browser reset use separate ephemeral state. | Reserve the destination at dispatch, commit inventory on completion, and invalidate stale completion callbacks after a failure. |
| Python ML | The 10,000-row synthetic CSV uses category-specific disjoint dwell ranges, unseeded sampling, wall-clock dates and random IDs. The trainer uses a random split and label encoders. Three joblib files are present. | Replace with versioned data, chronological evaluation and portable model artifacts. Avoid deserializing legacy executable artifacts at runtime. |
| Placement / housekeeping | The tier penalty dominates modeled energy. Housekeeping generates moves and swaps; it lacks an execution-time resource and feasibility model. | Retain expected pickup and relative travel as decision signals. Enforce reachability, compatibility, and shared resources at dispatch. |
| Unity | `NetworkManager.cs` connects to port 3000 while Node defaults to 3001. Unity has a hardcoded retrieval slot and expects numeric grid/row/tier coordinates, while Node generates letter grid/column/row IDs. | Render versioned simulator events in browser Three.js. Keep the scene as historical source. |
| Energy | Node, Python, the browser and Unity account for different pieces of movement energy. The old comparison is an estimate against random placement, without a matched experiment. | Centralize movement and idle energy. Replay identical workloads across policies and disclose boundary and assumptions. |
| Browser | CRA consumes Socket.IO and also owns independent crane, anomaly, forecast, and what-if logic. Randomness and wall-clock IDs prevent reproducible browser replays. | The browser projects Python event traces and submits scenario inputs. |
| Delivery | Root instructions start separate services manually. No hosted CI/deployment pipeline was present in the audited commit. | Vite and one Python service, with versioned replay artifacts and local/cloud configuration. |

Existing PNGs are materialized in the working tree but are LFS pointers in the index. This host lacks `git-lfs`; Git read-only status used one-command filter overrides. The PNGs and historical code were left in place.
