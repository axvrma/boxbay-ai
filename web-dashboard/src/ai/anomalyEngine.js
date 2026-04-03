/**
 * Anomaly Detection Engine
 * 
 * AI Techniques:
 * - Statistical deviation analysis (Z-score)
 * - Rule-based pattern matching
 * - Time-series anomaly detection
 */

// Baseline thresholds (would normally be learned from historical data)
const BASELINE = {
  avgDwellDays: 5,
  stdDwellDays: 2,
  avgEnergyPerMove: 0.15,
  stdEnergyPerMove: 0.05,
  avgMovesPerHour: 8,
  stdMovesPerHour: 3,
  avgUtilization: 60,
  stdUtilization: 15,
  maxTierViolations: 3
};

// Anomaly severity thresholds
const Z_SCORE_THRESHOLDS = {
  LOW: 1.5,
  MEDIUM: 2.0,
  HIGH: 2.5,
  CRITICAL: 3.0
};

/**
 * Calculate Z-score for a value
 */
export const calculateZScore = (value, mean, std) => {
  if (std === 0) return 0;
  return (value - mean) / std;
};

/**
 * Get severity level from Z-score
 */
export const getSeverityFromZScore = (zScore) => {
  const absZ = Math.abs(zScore);
  if (absZ >= Z_SCORE_THRESHOLDS.CRITICAL) return 'CRITICAL';
  if (absZ >= Z_SCORE_THRESHOLDS.HIGH) return 'HIGH';
  if (absZ >= Z_SCORE_THRESHOLDS.MEDIUM) return 'MEDIUM';
  if (absZ >= Z_SCORE_THRESHOLDS.LOW) return 'LOW';
  return null;
};

/**
 * Detect dwell time anomalies
 */
export const detectDwellAnomalies = (gridState) => {
  const anomalies = [];
  const occupiedSlots = gridState.filter(s => s.status === 'occupied');
  
  if (occupiedSlots.length === 0) return anomalies;
  
  // Calculate current average dwell
  const now = new Date();
  const dwellDays = occupiedSlots.map(slot => {
    if (!slot.expectedOutboundDate) return BASELINE.avgDwellDays;
    const outDate = new Date(slot.expectedOutboundDate);
    return Math.max(0, Math.ceil((outDate - now) / (1000 * 60 * 60 * 24)));
  });
  
  const avgDwell = dwellDays.reduce((a, b) => a + b, 0) / dwellDays.length;
  const zScore = calculateZScore(avgDwell, BASELINE.avgDwellDays, BASELINE.stdDwellDays);
  const severity = getSeverityFromZScore(zScore);
  
  if (severity) {
    anomalies.push({
      id: `dwell_${Date.now()}`,
      type: 'DWELL_ANOMALY',
      severity,
      title: zScore > 0 ? 'Extended dwell times detected' : 'Unusually short dwell times',
      message: `Average dwell time is ${avgDwell.toFixed(1)} days (${zScore > 0 ? 'above' : 'below'} normal)`,
      value: avgDwell,
      expected: BASELINE.avgDwellDays,
      zScore: Math.round(zScore * 100) / 100,
      recommendation: zScore > 0 
        ? 'Review receiver pickup schedules and contact delayed receivers'
        : 'Verify container data accuracy - unusually fast turnover',
      timestamp: Date.now()
    });
  }
  
  // Check for receiver-specific patterns
  const receiverGroups = {};
  occupiedSlots.forEach(slot => {
    const rcvr = slot.receiverId || 'unknown';
    if (!receiverGroups[rcvr]) receiverGroups[rcvr] = [];
    receiverGroups[rcvr].push(slot);
  });
  
  Object.entries(receiverGroups).forEach(([receiverId, slots]) => {
    if (slots.length >= 3) {
      const rcvrDwells = slots.map(s => {
        if (!s.expectedOutboundDate) return BASELINE.avgDwellDays;
        return Math.ceil((new Date(s.expectedOutboundDate) - now) / (1000 * 60 * 60 * 24));
      });
      const avgRcvrDwell = rcvrDwells.reduce((a, b) => a + b, 0) / rcvrDwells.length;
      
      if (avgRcvrDwell > 10) {
        anomalies.push({
          id: `rcvr_dwell_${receiverId}_${Date.now()}`,
          type: 'RECEIVER_PATTERN',
          severity: 'MEDIUM',
          title: `Receiver ${receiverId} has extended dwell pattern`,
          message: `${slots.length} containers from this receiver, avg ${avgRcvrDwell.toFixed(1)} days dwell`,
          value: avgRcvrDwell,
          recommendation: 'Investigate receiver relationship and pickup schedule',
          timestamp: Date.now()
        });
      }
    }
  });
  
  return anomalies;
};

/**
 * Detect energy consumption anomalies
 */
export const detectEnergyAnomalies = (energyData, recentMoves = 10) => {
  const anomalies = [];
  
  if (!energyData || !energyData.totalEnergy) return anomalies;
  
  const avgEnergyPerMove = energyData.totalEnergy / Math.max(1, recentMoves);
  const zScore = calculateZScore(avgEnergyPerMove, BASELINE.avgEnergyPerMove, BASELINE.stdEnergyPerMove);
  const severity = getSeverityFromZScore(zScore);
  
  if (severity && zScore > 0) {
    anomalies.push({
      id: `energy_${Date.now()}`,
      type: 'ENERGY_SPIKE',
      severity,
      title: 'Energy consumption spike detected',
      message: `${(avgEnergyPerMove * 1000).toFixed(0)} Wh per move (${Math.round(zScore * 100) / 100}σ above normal)`,
      value: avgEnergyPerMove,
      expected: BASELINE.avgEnergyPerMove,
      zScore: Math.round(zScore * 100) / 100,
      recommendation: 'Check crane calibration and verify container weights',
      timestamp: Date.now()
    });
  }
  
  return anomalies;
};

/**
 * Detect tier placement violations
 */
export const detectTierViolations = (gridState) => {
  const anomalies = [];
  const now = new Date();
  
  const violations = gridState.filter(slot => {
    if (slot.status !== 'occupied' || !slot.expectedOutboundDate) return false;
    
    const outDate = new Date(slot.expectedOutboundDate);
    const dwellDays = Math.ceil((outDate - now) / (1000 * 60 * 60 * 24));
    
    // Fast mover in wrong tier
    if (dwellDays <= 3 && slot.row === 3) return true;
    // Slow mover in wrong tier
    if (dwellDays > 7 && slot.row === 1) return true;
    
    return false;
  });
  
  if (violations.length > BASELINE.maxTierViolations) {
    anomalies.push({
      id: `tier_${Date.now()}`,
      type: 'TIER_VIOLATION',
      severity: violations.length > 6 ? 'HIGH' : 'MEDIUM',
      title: 'Multiple tier placement violations',
      message: `${violations.length} containers in non-optimal tiers`,
      value: violations.length,
      expected: 0,
      containers: violations.map(v => v.containerId),
      recommendation: 'BoxBay direct-access minimizes impact, but review placement algorithm',
      timestamp: Date.now()
    });
  }
  
  return anomalies;
};

/**
 * Detect throughput anomalies
 */
export const detectThroughputAnomalies = (metrics) => {
  const anomalies = [];
  
  if (!metrics || !metrics.operations) return anomalies;
  
  const movesPerHour = metrics.operations.totalMoves / Math.max(1, metrics.operations.hoursActive || 1);
  const zScore = calculateZScore(movesPerHour, BASELINE.avgMovesPerHour, BASELINE.stdMovesPerHour);
  const severity = getSeverityFromZScore(zScore);
  
  if (severity && zScore < 0) {
    anomalies.push({
      id: `throughput_${Date.now()}`,
      type: 'THROUGHPUT_DROP',
      severity,
      title: 'Throughput below expected levels',
      message: `${movesPerHour.toFixed(1)} moves/hour (${Math.abs(Math.round(zScore * 100) / 100)}σ below normal)`,
      value: movesPerHour,
      expected: BASELINE.avgMovesPerHour,
      zScore: Math.round(zScore * 100) / 100,
      recommendation: 'Check for crane issues, staffing gaps, or system bottlenecks',
      timestamp: Date.now()
    });
  }
  
  return anomalies;
};

/**
 * Detect utilization anomalies
 */
export const detectUtilizationAnomalies = (gridState, totalSlots = 30) => {
  const anomalies = [];
  
  const occupied = gridState.filter(s => s.status === 'occupied').length;
  const utilization = (occupied / totalSlots) * 100;
  
  if (utilization > 90) {
    anomalies.push({
      id: `util_high_${Date.now()}`,
      type: 'HIGH_UTILIZATION',
      severity: utilization > 95 ? 'CRITICAL' : 'HIGH',
      title: 'Grid approaching capacity',
      message: `${utilization.toFixed(0)}% utilization - ${totalSlots - occupied} slots remaining`,
      value: utilization,
      expected: BASELINE.avgUtilization,
      recommendation: 'Expedite departures and consider overflow procedures',
      timestamp: Date.now()
    });
  }
  
  return anomalies;
};

/**
 * Calculate overall system health score
 */
export const calculateHealthScore = (anomalies) => {
  if (anomalies.length === 0) return 100;
  
  const severityPenalties = {
    LOW: 5,
    MEDIUM: 15,
    HIGH: 25,
    CRITICAL: 40
  };
  
  const totalPenalty = anomalies.reduce((sum, a) => 
    sum + (severityPenalties[a.severity] || 10), 0
  );
  
  return Math.max(0, 100 - totalPenalty);
};

/**
 * Run full anomaly detection
 */
export const detectAllAnomalies = (gridState, energyData, metrics) => {
  const allAnomalies = [
    ...detectDwellAnomalies(gridState),
    ...detectEnergyAnomalies(energyData, metrics?.operations?.totalMoves),
    ...detectTierViolations(gridState),
    ...detectThroughputAnomalies(metrics),
    ...detectUtilizationAnomalies(gridState)
  ];
  
  // Sort by severity
  const severityOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  allAnomalies.sort((a, b) => 
    (severityOrder[a.severity] || 4) - (severityOrder[b.severity] || 4)
  );
  
  return {
    anomalies: allAnomalies,
    healthScore: calculateHealthScore(allAnomalies),
    summary: {
      total: allAnomalies.length,
      critical: allAnomalies.filter(a => a.severity === 'CRITICAL').length,
      high: allAnomalies.filter(a => a.severity === 'HIGH').length,
      medium: allAnomalies.filter(a => a.severity === 'MEDIUM').length,
      low: allAnomalies.filter(a => a.severity === 'LOW').length
    },
    timestamp: Date.now()
  };
};

/**
 * Get anomaly history (simulated for demo)
 */
export const generateAnomalyHistory = (hoursBack = 24) => {
  const history = [];
  const now = Date.now();
  
  // Generate some historical anomalies for visualization
  const types = ['DWELL_ANOMALY', 'ENERGY_SPIKE', 'TIER_VIOLATION', 'THROUGHPUT_DROP'];
  const severities = ['LOW', 'MEDIUM', 'HIGH'];
  
  for (let i = 0; i < hoursBack; i++) {
    // 30% chance of anomaly per hour
    if (Math.random() < 0.3) {
      history.push({
        timestamp: now - (i * 60 * 60 * 1000),
        type: types[Math.floor(Math.random() * types.length)],
        severity: severities[Math.floor(Math.random() * severities.length)],
        resolved: i > 2 // Older ones are resolved
      });
    }
  }
  
  return history.reverse();
};

export default {
  calculateZScore,
  getSeverityFromZScore,
  detectDwellAnomalies,
  detectEnergyAnomalies,
  detectTierViolations,
  detectThroughputAnomalies,
  detectUtilizationAnomalies,
  calculateHealthScore,
  detectAllAnomalies,
  generateAnomalyHistory
};
