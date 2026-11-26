# Local development

Use Python 3.11 and Node 22.12+. Apple Silicon training needs `brew install libomp`. Run `make setup`, then `make api` and `make web` in separate terminals. Use `http://127.0.0.1:5173`. FastAPI docs are at `http://127.0.0.1:8000/docs`. SQLite files live under `.boxbay/`.

For containers, run `docker compose up --build` from the root. Both ports bind to loopback. The compose-only operator credential is `local-boxbay-operator`. Use the Operator access control to enter it. Stop with `docker compose down`. The named volume stores local results between starts.

The browser can be served from the production build with `npm --prefix apps/web run preview`. The Vite dev proxy connects the two local processes. Production requires a `VITE_API_BASE_URL` to reach an external backend. The replay UI remains usable with static evidence.

If a local build has a verified Linux wheel cache for its Python version and architecture, run `docker build --build-context wheelhouse=/absolute/path/to/wheels --build-arg PIP_NO_INDEX=1 -t boxbay-ai-api:local .`. The default Docker build installs from PyPI.
