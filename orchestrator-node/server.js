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

// SCENARIO 2: GPS Tracking (Triggered by Slider on UI)
app.post('/api/tracking/update', trackingController.updateGPS);

server.listen(PORT, () => {
    console.log(`🚀 Orchestrator running on http://localhost:${PORT}`);
});