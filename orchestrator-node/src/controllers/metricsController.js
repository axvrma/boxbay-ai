const { energyOps, metricsOps, slotOps, containerOps } = require('../db/database');

// Energy calculation constants
const GRAVITY = 9.81;
const TIER_HEIGHT_METERS = 3.0;
const EFFICIENCY_LIFT = 0.85;
const EFFICIENCY_REGEN = 0.40;
const JOULES_TO_KWH = 2.77778e-7;
const ENERGY_COST_PER_KWH = 0.30; // USD

// Calculate energy for a given slot and weight
function calculateEnergy(row, weightTons) {
    const massKg = weightTons * 1000;
    const height = (row - 1) * TIER_HEIGHT_METERS;
    
    const potentialEnergy = massKg * GRAVITY * height;
    const liftKwh = (potentialEnergy / EFFICIENCY_LIFT) * JOULES_TO_KWH;
    const regenKwh = (potentialEnergy * EFFICIENCY_REGEN) * JOULES_TO_KWH;
    const netKwh = liftKwh - regenKwh;
    
    return { liftKwh, regenKwh, netKwh };
}

// Calculate what random placement would cost (average of all rows)
function calculateRandomEnergy(weightTons) {
    const rows = [1, 2, 3];
    let totalNet = 0;
    
    rows.forEach(row => {
        const { netKwh } = calculateEnergy(row, weightTons);
        totalNet += netKwh;
    });
    
    return totalNet / rows.length;
}

// Get comprehensive metrics for the dashboard
exports.getMetrics = async (req, res) => {
    try {
        // Get today's energy data
        const energyToday = energyOps.getTodayTotal.get();
        
        // Get all slots for utilization calculation
        const allSlots = slotOps.getAll.all();
        const occupiedSlots = allSlots.filter(s => s.container_id !== null);
        const utilizationPct = (occupiedSlots.length / allSlots.length) * 100;
        
        // Count tier violations
        let violations = 0;
        const gridState = require('../models/gridState');
        const slots = gridState.getAllSlots();
        
        slots.forEach(slot => {
            if (slot.status === 'occupied' && slot.expectedOutboundDate) {
                const now = new Date();
                const outDate = new Date(slot.expectedOutboundDate);
                const dwellDays = Math.ceil((outDate - now) / (1000 * 60 * 60 * 24));
                
                let optimalRow = 2;
                if (dwellDays < 3) optimalRow = 1;
                else if (dwellDays > 7) optimalRow = 3;
                
                if (slot.row !== optimalRow) violations++;
            }
        });
        
        // Calculate savings
        const smartEnergy = energyToday.total_net || 0;
        const randomEnergy = energyToday.total_random || 0;
        const energySaved = randomEnergy - smartEnergy;
        const moneySaved = energySaved * ENERGY_COST_PER_KWH;
        
        // Calculate tier distribution
        const tierDistribution = {
            fast: slots.filter(s => {
                if (s.status !== 'occupied' || !s.expectedOutboundDate) return false;
                const days = Math.ceil((new Date(s.expectedOutboundDate) - new Date()) / (1000 * 60 * 60 * 24));
                return days < 3;
            }).length,
            medium: slots.filter(s => {
                if (s.status !== 'occupied' || !s.expectedOutboundDate) return false;
                const days = Math.ceil((new Date(s.expectedOutboundDate) - new Date()) / (1000 * 60 * 60 * 24));
                return days >= 3 && days <= 7;
            }).length,
            slow: slots.filter(s => {
                if (s.status !== 'occupied' || !s.expectedOutboundDate) return false;
                const days = Math.ceil((new Date(s.expectedOutboundDate) - new Date()) / (1000 * 60 * 60 * 24));
                return days > 7;
            }).length
        };
        
        res.json({
            energy: {
                todayKwh: Math.round(smartEnergy * 100) / 100,
                randomKwh: Math.round(randomEnergy * 100) / 100,
                savedKwh: Math.round(energySaved * 100) / 100,
                savedPct: randomEnergy > 0 ? Math.round((energySaved / randomEnergy) * 100) : 0,
                savedUsd: Math.round(moneySaved * 100) / 100
            },
            operations: {
                movesToday: energyToday.move_count || 0,
                utilizationPct: Math.round(utilizationPct),
                violations: violations,
                correctTierPct: occupiedSlots.length > 0 
                    ? Math.round(((occupiedSlots.length - violations) / occupiedSlots.length) * 100)
                    : 100
            },
            capacity: {
                totalSlots: allSlots.length,
                occupied: occupiedSlots.length,
                available: allSlots.length - occupiedSlots.length,
                tierDistribution
            },
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('Metrics Error:', error);
        res.status(500).json({ error: 'Failed to fetch metrics' });
    }
};

// Get hourly energy breakdown for charts
exports.getEnergyAnalytics = async (req, res) => {
    try {
        const hourlyData = energyOps.getHourly.all();
        
        // Fill in missing hours with zeros
        const fullDay = [];
        for (let h = 0; h < 24; h++) {
            const hourStr = h.toString().padStart(2, '0');
            const existing = hourlyData.find(d => d.hour === hourStr);
            fullDay.push({
                hour: `${hourStr}:00`,
                smart: existing ? Math.round(existing.smart_kwh * 100) / 100 : 0,
                random: existing ? Math.round(existing.random_kwh * 100) / 100 : 0
            });
        }
        
        // Get recent events for the activity log
        const recentEvents = energyOps.getRecent.all(20);
        
        res.json({
            hourly: fullDay,
            recentEvents: recentEvents.map(e => ({
                timestamp: e.timestamp,
                containerId: e.container_id,
                slotId: e.slot_id,
                operation: e.operation,
                netKwh: Math.round(e.net_kwh * 1000) / 1000
            }))
        });
        
    } catch (error) {
        console.error('Energy Analytics Error:', error);
        res.status(500).json({ error: 'Failed to fetch energy analytics' });
    }
};

// Log an energy event (called internally)
exports.logEnergyEvent = (containerId, slotId, operation, row, weightTons) => {
    const { liftKwh, regenKwh, netKwh } = calculateEnergy(row, weightTons);
    const randomKwh = calculateRandomEnergy(weightTons);
    
    energyOps.log.run(
        containerId,
        slotId,
        operation,
        liftKwh,
        regenKwh,
        netKwh,
        randomKwh
    );
    
    return { liftKwh, regenKwh, netKwh, randomKwh };
};

module.exports = exports;
