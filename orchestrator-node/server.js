const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
require('dotenv').config();

// Import Controllers
const inboundController = require('./src/controllers/inboundController');
const trackingController = require('./src/controllers/trackingController.js');

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

const PORT = process.env.PORT || 3000;

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
        // data: { containerId, actualEnergyUsed, regenRecovered }
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

// --- GRID MANAGEMENT ---
const gridState = require('./src/models/gridState');

app.get('/api/grid/status', (req, res) => {
    res.json(gridState.getAllSlots());
});

// --- PROXY ROUTES FOR SMART INBOUND ---
const axios = require('axios'); // Ensure axios is required if using it here, but server.js didn't import it at top. Checking if needed.
// Wait, axios is likely needed. Let's add it at the top or assume it's global? No, need to require it.
// Checking imports: const express...
// I should probably add const axios = require('axios'); at the top in a separate edit or inline it here if possible, but standard is top.
// Let's add these routes.

app.get('/api/receivers', async (req, res) => {
    try {
        const axios = require('axios');
        const response = await axios.get(`${process.env.PYTHON_ML_SERVICE || 'http://localhost:8000'}/receivers`);
        res.json(response.data);
    } catch (err) {
        console.error("Error fetching receivers:", err.message);
        res.status(500).json({ error: "Failed to fetch receivers" });
    }
});

app.post('/api/inbound/predict', async (req, res) => {
    try {
        const axios = require('axios');
        const response = await axios.post(`${process.env.PYTHON_ML_SERVICE || 'http://localhost:8000'}/predict-date`, req.body);
        res.json(response.data);
    } catch (err) {
        console.error("Error fetching prediction:", err.message);
        res.status(500).json({ error: "Prediction failed" });
    }
});

server.listen(PORT, () => {
    console.log(`🚀 Orchestrator running on http://localhost:${PORT}`);
});