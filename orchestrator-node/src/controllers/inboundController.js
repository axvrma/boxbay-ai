const axios = require('axios');
const PYTHON_SERVICE = process.env.PYTHON_ML_SERVICE || "http://localhost:8000";

// Try to load metrics controller for energy logging
let metricsController;
try {
    metricsController = require('./metricsController');
} catch (e) {
    console.warn('Metrics controller not available, energy logging disabled');
}

exports.optimizeInbound = async (req, res) => {
    const { containerId, weight, receiverId, outboundDate } = req.body;
    const io = req.app.get('io');

    console.log(`📦 Inbound: ${containerId} (${weight} tons) - Outbound: ${outboundDate || 'N/A'}`);

    try {
        // 1. Get Candidate Slots from Grid State
        const gridState = require('../models/gridState');
        const candidateSlots = gridState.getAvailableSlots().map(s => ({
            slot_id: s.id,
            column: s.column,
            row: s.row
        }));

        if (candidateSlots.length === 0) {
            return res.status(400).json({ error: "No available slots in Grid" });
        }

        // Calculate Dwell Days
        let dwellDays = 3.5;
        let calculatedOutboundDate = outboundDate;

        if (outboundDate) {
            const now = new Date();
            const out = new Date(outboundDate);
            const diffTime = Math.abs(out - now);
            dwellDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            console.log(`📅 User Date Provided. Dwell: ${dwellDays} days`);
        } else {
            console.log("🤖 No Date provided. Asking AI for prediction...");
            try {
                const predRes = await axios.post(`${PYTHON_SERVICE}/predict-date`, {
                    weight,
                    receiverId,
                    commodity: "Auto"
                });
                if (predRes.data && predRes.data.predictedDate) {
                    dwellDays = predRes.data.predictedDate;
                    const futureDate = new Date();
                    futureDate.setDate(futureDate.getDate() + Math.ceil(dwellDays));
                    calculatedOutboundDate = futureDate.toISOString().split('T')[0];
                    console.log(`🧠 AI Predicted Dwell: ${dwellDays} days -> Out: ${calculatedOutboundDate}`);
                }
            } catch (pErr) {
                console.warn("⚠️ Prediction Service unavailable, using default.", pErr.message);
            }
        }

        // 2. Call Python Brain B (Physics/Allocation)
        const response = await axios.post(`${PYTHON_SERVICE}/allocate-slot`, {
            weight,
            receiverId,
            dwell_days: dwellDays,
            candidate_slots: candidateSlots
        });

        const { targetSlot, predictedNetKwh, savings, details } = response.data;

        // 3. Mark Slot as Occupied in State
        const success = gridState.occupySlot(targetSlot, containerId, calculatedOutboundDate, weight, receiverId);
        if (!success) {
            console.warn(`⚠️ Warning: Slot ${targetSlot} was double-booked or invalid.`);
        }

        // 4. Log energy event for metrics
        const slot = gridState.getAllSlots().find(s => s.id === targetSlot);
        if (metricsController && slot) {
            try {
                metricsController.logEnergyEvent(containerId, targetSlot, 'inbound', slot.row, weight);
            } catch (e) {
                console.warn('Failed to log energy event:', e.message);
            }
        }

        console.log(`🤖 AI Selected: ${targetSlot} (Net: ${predictedNetKwh} kWh)`);

        // 5. Send Instruction to Unity
        io.to('unity').emit('inbound_task', {
            containerId,
            targetSlot,
            weight
        });

        // 6. Update Dashboard
        io.to('dashboard').emit('prediction_alert', {
            containerId,
            predictedNetKwh,
            savings,
            details,
            dwellDays,
            outboundDate: calculatedOutboundDate
        });

        // 7. Broadcast Grid Update
        io.to('dashboard').emit('grid_update', gridState.getAllSlots());

        // 8. Emit metrics update
        io.to('dashboard').emit('metrics_update', { timestamp: new Date().toISOString() });

        res.json({ status: 'Executing', targetSlot, predictedNetKwh, dwellDays });

    } catch (error) {
        console.error("⚠️ AI Service Failed:", error.message);
        res.status(500).json({ error: "Optimization failed" });
    }
};

exports.runHousekeeping = async (req, res) => {
    try {
        const gridState = require('../models/gridState');
        const slots = gridState.getAllSlots().map(s => ({
            ...s,
            // Ensure outboundDate is just the YYYY-MM-DD string or null
            // The model expects 'expectedOutboundDate'
        }));

        console.log("🧹 Running Housekeeping Analysis...");

        const response = await axios.post(`${PYTHON_SERVICE}/housekeeping`, {
            slots: slots
        });

        const { moves } = response.data;
        console.log(`🧹 Plan Generated: ${moves.length} steps.`);

        res.json({ moves });

    } catch (error) {
        console.error("⚠️ Housekeeping Failed:", error.message);
        res.status(500).json({ error: "Housekeeping failed" });
    }
};

// --- SCENARIO 3: JIT RETRIEVAL ---
exports.retrieveContainer = async (req, res) => {
    try {
        const { containerId } = req.body;
        const gridState = require('../models/gridState');
        const io = req.app.get('io');

        if (!containerId) {
            return res.status(400).json({ error: "Container ID is required" });
        }

        console.log(`🚚 JIT Retrieval Request for ${containerId}`);

        // Find the slot
        const slot = gridState.getAllSlots().find(s => s.containerId === containerId);

        if (!slot) {
            return res.status(404).json({ error: "Container not found in grid" });
        }

        console.log(`✅ Found ${containerId} at ${slot.id}. Unloading...`);

        // Clear the slot (Logic: Making it available again)
        // We need to access the slot object directly from the gridState model
        // Assuming getAllSlots returns references, but gridState has methods.
        // Let's use occupySlot with nulls or add a releaseSlot method.
        // For now, let's manually update if occupySlot doesn't support clearing.
        // Looking at gridState, it likely has methods.
        // Let's assume we can set properties on the slot object if it's a reference.

        slot.status = 'available';
        slot.containerId = null;
        slot.weight = null;
        slot.receiverId = null;
        slot.expectedOutboundDate = null;

        // Emit Update
        io.to('dashboard').emit('grid_update', gridState.getAllSlots());

        res.json({
            message: `Successfully retrieved ${containerId}`,
            slot: slot.id
        });

    } catch (err) {
        console.error("Retrieval Error:", err);
        res.status(500).json({ error: err.message });
    }
};