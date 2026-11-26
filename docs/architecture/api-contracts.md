# API contracts

Version 1 lives under `/api/v1`. FastAPI's schema at `/openapi.json` is committed in `packages/contracts/openapi.json` and generated into TypeScript. Run `make contracts` after contract changes. CI compares the generated files.

Public routes serve health, facility versions, catalog, recorded evidence and results identified by their opaque IDs. Use only public or synthetic inputs. Production mutations use Bearer operator credentials. Facility revisions require the administrator credential. The browser keeps the operator token in session storage. Local open authorization is explicit and only accepted for loopback clients.

Submit `POST /runs`, `POST /benchmarks` or `POST /optimization/validate-override` to receive a job ID. Poll `GET /jobs/{id}` during that task and cancel with DELETE. Paginated events and decisions accept offset and limit. Idempotency keys deduplicate equal job submissions within the worker lifetime and reject mismatched reuse. Failed or interrupted jobs can be resubmitted with a fresh key. Persistent results are available after restart. The queue itself is process-local and bounded.

Run payloads accept up to five vessel revisions. Revisions can move or cancel unreleased planning requests and keep appointment/pickup offsets. They are deterministic scenario inputs. The online worker validates the complete revised scenario before simulation.
