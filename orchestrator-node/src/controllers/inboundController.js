const axios = require('axios');
const PYTHON_SERVICE = process.env.PYTHON_ML_SERVICE || "http://localhost:8000";

exports.optimizeInbound = async (req, res) => {
    const { containerId, weight, receiverId, outboundDate } = req.body;
    const io = req.app.get('io');

    console.log(`📦 Inbound: ${containerId} (${weight} tons) - Outbound: ${outboundDate || 'N/A'}`);

    try {
        // 1. Get Candidate Slots from Grid State
        const gridState = require('../models/gridState');
        const candidateSlots = gridState.getAvailableSlots().map(s => ({
            slot_id: s.id,
            column: s.column
        }));

        if (candidateSlots.length === 0) {
            return res.status(400).json({ error: "No available slots in Grid" });
        }

        // Calculate Dwell Days
        let dwellDays = 3.5; // Default average
        if (outboundDate) {
            const now = new Date();
            const out = new Date(outboundDate);
            const diffTime = Math.abs(out - now);
            dwellDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        }

        // 2. Call Python Brain
        const response = await axios.post(`${PYTHON_SERVICE}/allocate-slot`, {
            weight,
            receiverId,
            dwell_days: dwellDays,
            candidate_slots: candidateSlots
        });

        // FIX: Extract 'details' so the graph can render
        const { targetSlot, predictedNetKwh, savings, details } = response.data;

        // 3. Mark Slot as Occupied in State
        const success = gridState.occupySlot(targetSlot, containerId, outboundDate, weight, receiverId);
        if (!success) {
            console.warn(`⚠️ Warning: Slot ${targetSlot} was double-booked or invalid.`);
        }

        console.log(`🤖 AI Selected: ${targetSlot} (Net: ${predictedNetKwh} kWh)`);

        // 4. Send Instruction to Unity
        io.to('unity').emit('inbound_task', {
            containerId,
            targetSlot,
            weight
        });

        // 5. Update Dashboard (Include 'details' now!)
        io.to('dashboard').emit('prediction_alert', {
            containerId,
            predictedNetKwh,
            savings,
            details // <--- THIS WAS MISSING
        });

        // 6. Broadcast Grid Update to Refresh UI instantly
        io.to('dashboard').emit('grid_update', gridState.getAllSlots());

        res.json({ status: 'Executing', targetSlot, predictedNetKwh });

    } catch (error) {
        console.error("⚠️ AI Service Failed:", error.message);
        res.status(500).json({ error: "Optimization failed" });
    }
};