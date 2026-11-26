# BOXBAY AI · Jebel Ali

BOXBAY AI is an independent, browser-native demonstration of predictive storage intelligence. The live demo starts with 45 stored containers, 64 individually accessible cells and an incoming electronics shipment. Predict dwell, inspect the model's sensitivities, approve a placement and evaluate proactive positioning. Each action runs against the present simulation state.

The operating data, receivers, vessels, equipment and financial rates are synthetic. The miniature layout is inspired by high-bay storage at Jebel Ali. Public port volumes are contextual and never used as facility inputs.

## Run locally

Use Node.js 22.12 or newer.

```sh
npm ci
npm run dev
```

Open [the demo](http://localhost:5173/) or [Engineering](http://localhost:5173/engineering). Python and a network inference service are unnecessary at runtime.

## Reproduce the trained artifacts

Use Python 3.11. On Apple Silicon, XGBoost may require Homebrew's `libomp`.

```sh
python3.11 -m venv .venv
source .venv/bin/activate
python3 -m pip install -r ml/requirements.txt
npm run generate:data
npm run train:model
npm run export:model
npm run benchmark
```

Generation defaults to 150,000 container records and 1,826 daily records for 2021–2025. The CLI accepts a seed and row count. Large CSVs are generated under `data/synthetic` locally. The versioned portable trees, synthetic demo inputs, numerical evidence and Python parity fixtures are committed. `train:model` trains and exports and `export:model` republishes the local trained output. Bump the model version and its browser contract when publishing changed artifacts at a new immutable URL.

## Verify

```sh
npm run lint
npm test
python3 -m unittest discover -s tests -p test_data.py
npm run build
npx playwright install chromium
npm run test:e2e
```

Playwright starts and stops a temporary Vite preview. The tests reject requests for APIs, external services and recordings during the executive workflow. The benchmark command uses the same browser simulation functions on matched workload inputs and exports only numerical summaries.

## Deploy to Netlify

Connect the repository as one Netlify site. The checked-in configuration runs `npm run build`, publishes `apps/web/dist`, routes direct SPA requests, and sets cache and security headers. The build consumes existing model files. No environment variables or cloud services are required. Assign `boxbay.axvrma.com` in Netlify and configure its DNS through the domain account.

- [Three-minute executive walkthrough](docs/demo/executive-walkthrough.md)
- [Engineering and reproducibility notes](docs/engineering/system.md)
