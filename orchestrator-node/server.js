const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

// Import Controllers
const inboundController = require('./src/controllers/inboundController');
const trackingController = require('./src/controllers/trackingController.js');
const metricsController = require('./src/controllers/metricsController');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3001;
const PYTHON_ML_SERVICE = process.env.PYTHON_ML_SERVICE || 'http://localhost:8000';

// --- SOCKET.IO CONNECTION ---
io.on('connection', (socket) => {
    console.log(`🔌 New Client: ${socket.id}`);

    // Allow Unity & Dashboard to identify themselves
    socket.on('register', (type) => {
        socket.join(type);
        console.log(`✅ Registered ${socket.id} as ${type}`);
    });

    // Unity sends actual energy data after a move
    socket.on('move_complete', (data) => {
        console.log(`🏗️ Move Complete. Net Energy: ${data.actualEnergyUsed - data.regenRecovered} kWh`);
        io.to('dashboard').emit('update_energy_log', data);
    });

    socket.on('disconnect', () => console.log('❌ Disconnected'));
});

// Make 'io' accessible to our controllers
app.set('io', io);

// --- API ROUTES ---

// SCENARIO 1: Smart Inbound (Triggered when Box is on Tray)
app.post('/api/inbound/optimize', inboundController.optimizeInbound);

// SCENARIO 2: Housekeeping (Smart Reshuffling)
app.post('/api/housekeeping', inboundController.runHousekeeping);

// SCENARIO 3: GPS Tracking (Triggered by Slider on UI)
app.post('/api/tracking/update', trackingController.updateGPS);
app.post('/api/outbound/retrieve', inboundController.retrieveContainer);

// --- GRID MANAGEMENT ---
const gridState = require('./src/models/gridState');

app.get('/api/grid/status', (req, res) => {
    res.json(gridState.getAllSlots());
});

app.post('/api/grid/reset', (req, res) => {
    gridState.resetGrid();
    io.to('dashboard').emit('grid_update', gridState.getAllSlots());
    res.json({ status: 'Grid reset successfully' });
});

// --- METRICS & ANALYTICS ---
app.get('/api/metrics', metricsController.getMetrics);
app.get('/api/metrics/energy', metricsController.getEnergyAnalytics);

// --- PROXY ROUTES FOR ML SERVICE ---
app.get('/api/receivers', async (req, res) => {
    try {
        const response = await axios.get(`${PYTHON_ML_SERVICE}/receivers`);
        res.json(response.data);
    } catch (err) {
        console.error("Error fetching receivers:", err.message);
        res.status(500).json({ error: "Failed to fetch receivers" });
    }
});

app.post('/api/inbound/predict', async (req, res) => {
    try {
        const response = await axios.post(`${PYTHON_ML_SERVICE}/predict-date`, req.body);
        res.json(response.data);
    } catch (err) {
        console.error("Error fetching prediction:", err.message);
        res.status(500).json({ error: "Prediction failed" });
    }
});

// --- HEALTH CHECK ---
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        services: {
            orchestrator: true,
            mlService: PYTHON_ML_SERVICE
        }
    });
});

server.listen(PORT, () => {
    console.log(`🚀 Orchestrator running on http://localhost:${PORT}`);
    console.log(`📡 ML Service expected at: ${PYTHON_ML_SERVICE}`);
});