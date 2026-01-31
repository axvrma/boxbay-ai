// Simple memory set to track trucks that have already triggered a crane job
const dispatchedTrucks = new Set();

exports.updateGPS = (req, res) => {
    const { truckId, containerId, distanceKm, speedKmH } = req.body;
    const io = req.app.get('io');

    // 0. RESET LOGIC (For Demo Purposes)
    // If you drag the slider back to > 5km, we assume you want to reset the demo
    if (distanceKm > 5.0 && dispatchedTrucks.has(truckId)) {
        dispatchedTrucks.delete(truckId);
        console.log(`🔄 Resetting simulation for Truck ${truckId}`);
    }

    // 1. If already dispatched, ignore this update (Prevent Repetition)
    if (dispatchedTrucks.has(truckId)) {
        return res.json({ status: 'ALREADY_DISPATCHED', distanceKm });
    }

    // 2. Calculate ETA
    const speedPerMin = speedKmH / 60;
    const etaMinutes = distanceKm / speedPerMin;

    console.log(`🚚 Truck ${truckId}: ${distanceKm}km away. ETA: ${etaMinutes.toFixed(1)} mins`);

    // 3. Trigger Logic
    const TRIGGER_THRESHOLD = 2.5; // Minutes

    if (etaMinutes <= TRIGGER_THRESHOLD) {
        console.log(`⚡ PRE-FETCH TRIGGERED for ${containerId}!`);

        // MARK AS DISPATCHED (The Fix)
        dispatchedTrucks.add(truckId);

        io.to('unity').emit('outbound_task', {
            containerId,
            priority: 'URGENT'
        });

        io.to('dashboard').emit('prefetch_alert', {
            truckId,
            status: 'CRANE_DISPATCHED',
            eta: etaMinutes
        });

        return res.json({ status: 'DISPATCHED', eta: etaMinutes });
    }

    res.json({ status: 'TRACKING', eta: etaMinutes });
};