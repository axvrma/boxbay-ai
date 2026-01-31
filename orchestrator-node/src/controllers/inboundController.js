const axios = require('axios');
const PYTHON_SERVICE = process.env.PYTHON_ML_SERVICE || "http://localhost:8000";

exports.optimizeInbound = async (req, res) => {
    const { containerId, weight, receiverId } = req.body;
    const io = req.app.get('io');

    console.log(`📦 Inbound: ${containerId} (${weight} tons)`);

    try {
        // 1. Call Python Brain
        const response = await axios.post(`${PYTHON_SERVICE}/allocate-slot`, {
            weight,
            receiverId
        });

        // FIX: Extract 'details' so the graph can render
        const { targetSlot, predictedNetKwh, savings, details } = response.data;

        console.log(`🤖 AI Selected: ${targetSlot} (Net: ${predictedNetKwh} kWh)`);

        // 2. Send Instruction to Unity
        io.to('unity').emit('inbound_task', {
            containerId,
            targetSlot,
            weight
        });

        // 3. Update Dashboard (Include 'details' now!)
        io.to('dashboard').emit('prediction_alert', {
            containerId,
            predictedNetKwh,
            savings,
            details // <--- THIS WAS MISSING
        });

        res.json({ status: 'Executing', targetSlot, predictedNetKwh });

    } catch (error) {
        console.error("⚠️ AI Service Failed:", error.message);
        res.status(500).json({ error: "Optimization failed" });
    }
};