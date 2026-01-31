boxbay-digital-twin/
├── orchestrator-node/       # Node.js "Central Nervous System"
│   ├── src/
│   │   ├── controllers/     # Logic for Truck events & Port states
│   │   ├── services/        # Logic to call Python ML models
│   │   ├── sockets/         # Socket.io setup for Unity real-time feed
│   │   └── server.js        # Entry point
│   ├── config/              # DB & Environment configs
│   └── package.json
│
├── ml-services/             # Python "AI Brains" (FastAPI/Flask)
│   ├── dwell-time-model/    # Brain A: Predictive
│   │   ├── model/           # Saved .joblib or .pkl artifacts
│   │   ├── trainer.py       # Script to train from synthetic data
│   │   └── predictor.py     # Inference logic
│   ├── slot-allocator/      # Brain B: Prescriptive (ML-Agents)
│   │   ├── config/          # PPO/DQN hyperparameters (.yaml)
│   │   └── results/         # Training logs and .onnx models
│   ├── shared/              # Shared data generation scripts
│   └── requirements.txt     # Python dependencies
│
├── unity-simulation/        # Unity "Physical Body"
│   ├── Assets/
│   │   ├── Scripts/         # C# scripts (Crane, Energy, Sockets)
│   │   ├── Prefabs/         # Reusable Containers, Cranes, Tracks
│   │   ├── Scenes/          # Main Tower & Sandbox scenes
│   │   └── ML-Agents/       # Training environment setup
│   ├── ProjectSettings/
│   └── Packages/            # ML-Agents & Socket.io packages
│
├── dashboard-ui/            # Frontend (React/Angular)
│   ├── src/                 # Energy Heatmaps & Manual Overrides
│   └── package.json
│
├── data/                    # Shared data storage
│   ├── synthetic_logs.csv   # The 10k generated records
│   └── database-dumps/      # Initial SQL schema scripts
│
└── README.md                # Project Roadmap & Setup Instructions