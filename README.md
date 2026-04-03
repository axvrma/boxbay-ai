# BoxBay Digital Twin

A smart container yard management system that uses AI to optimize container storage and retrieval in a BoxBay-style vertical stacking system.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Dashboard (React)                             │
│  ┌─────────┐ ┌─────────────┐ ┌──────────────┐ ┌─────────────────┐  │
│  │ KPI Bar │ │ Energy Chart│ │ Grid Visual  │ │ Control Panels  │  │
│  └─────────┘ └─────────────┘ └──────────────┘ └─────────────────┘  │
└────────────────────────────────┬────────────────────────────────────┘
                                 │ REST + Socket.io
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     Orchestrator (Node.js)                          │
│  ┌──────────────┐ ┌───────────────┐ ┌─────────────┐ ┌───────────┐  │
│  │ Slot Allocator│ │Energy Calculator│ │ Grid State │ │ Metrics  │  │
│  └──────────────┘ └───────────────┘ └─────────────┘ └───────────┘  │
└────────────────────────────────┬────────────────────────────────────┘
                                 │ HTTP
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      ML Service (Python FastAPI)                     │
│  ┌─────────────────┐ ┌─────────────────┐ ┌────────────────────┐    │
│  │ Dwell Predictor │ │ Slot Allocator  │ │ Housekeeping AI    │    │
│  │   (XGBoost)     │ │  (Physics)      │ │  (Rule-based)      │    │
│  └─────────────────┘ └─────────────────┘ └────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

## Features

### Smart Inbound (Scenario 1)
- AI predicts container dwell time based on receiver history
- Physics-based slot allocation minimizes energy consumption
- Tiered placement: Fast movers → Bottom, Slow movers → Top

### Smart Housekeeping (Scenario 2)
- Scans grid for tier violations
- Generates optimized reshuffling plans
- Uses transfer tray for complex swaps

### Just-in-Time Retrieval (Scenario 3)
- GPS-triggered crane dispatch
- Zero truck wait time optimization
- Real-time ETA tracking

## Quick Start

### Prerequisites
- Node.js 18+
- Python 3.10+
- npm or yarn

### 1. Start the ML Service

```bash
cd ml-services

# Create virtual environment
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Generate training data (first time only)
python shared/generate_synthetic_logistics_data.py

# Train the model (first time only)
python dwell-time-model/trainer.py

# Start the service
uvicorn main:app --host 0.0.0.0 --port 8000
```

### 2. Start the Orchestrator

```bash
cd orchestrator-node

# Install dependencies
npm install

# Start the server
npm start
```

### 3. Start the Dashboard

```bash
cd web-dashboard

# Install dependencies
npm install

# Start the dev server
npm start
```

### 4. Open the Dashboard

Navigate to `http://localhost:3000` in your browser.

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/inbound/optimize` | Get optimal slot for new container |
| POST | `/api/outbound/retrieve` | Mark container for retrieval |
| POST | `/api/housekeeping` | Trigger tier violation scan |
| GET | `/api/grid/status` | Current grid state |
| GET | `/api/metrics` | KPIs and statistics |
| GET | `/api/metrics/energy` | Energy analytics |
| GET | `/api/receivers` | List of receivers |
| POST | `/api/inbound/predict` | Predict dwell time |

## Energy Calculation

The system uses physics-based energy calculation:

```
Net_kWh = E_lift - (E_regen × η_eff)

Where:
- E_lift = mgh (mass × gravity × height)
- E_regen = Energy recovered via regenerative braking
- η_eff = Regeneration efficiency (40%)
```

### Tiering Strategy

| Dwell Time | Target Row | Rationale |
|------------|------------|-----------|
| < 3 days | Row 1 (Bottom) | Minimize energy for frequent access |
| 3-7 days | Row 2 (Middle) | Balanced placement |
| > 7 days | Row 3 (Top) | Store and forget |

## Dashboard Components

- **KPI Bar**: Energy, moves, throughput, savings, utilization
- **Grid Visualization**: Color-coded by dwell tier (Blue=Fast, Orange=Medium, Red=Slow)
- **Energy Chart**: Smart vs Random placement comparison
- **Operational Metrics**: Crane efficiency, tier accuracy, violations
- **Truck Queue**: Incoming trucks with ETA
- **Live Log**: Real-time event stream

## Configuration

### Environment Variables

**Orchestrator (orchestrator-node/.env)**
```
PORT=3001
PYTHON_ML_SERVICE=http://localhost:8000
```

**Dashboard**
Update `SOCKET_SERVER` in `web-dashboard/src/App.js` if needed.

## Project Structure

```
boxbay-digital-twin/
├── ml-services/              # Python ML Service
│   ├── main.py               # FastAPI app
│   ├── dwell-time-model/     # XGBoost model
│   ├── shared/               # Data generation
│   └── data/                 # Training data
│
├── orchestrator-node/        # Node.js Backend
│   ├── server.js             # Express + Socket.io
│   └── src/
│       ├── controllers/      # API handlers
│       ├── models/           # Grid state
│       └── db/               # SQLite schema
│
├── web-dashboard/            # React Frontend
│   └── src/
│       ├── components/       # UI components
│       └── App.js            # Main app
│
└── data/                     # Shared data
    └── boxbay.db             # SQLite database
```

## Future Enhancements

- [ ] Unity 3D visualization integration
- [ ] Reefer container management
- [ ] Hazmat segregation rules
- [ ] Vessel schedule integration
- [ ] Multi-module yard support
