/**
 * Simulation Engine - What-If Scenario Simulator
 * 
 * AI Techniques:
 * - Monte Carlo simulation
 * - Comparative analysis
 * - Statistical aggregation
 */

import {
  createVirtualGrid,
  placeContainer,
  tick,
  getGridStats,
  cloneGrid,
  initializeFromState
} from './virtualGrid';

// Scenario presets
export const SCENARIO_PRESETS = {
  PEAK_SEASON: {
    id: 'peak_season',
    name: 'Peak Season Rush',
    description: 'Simulate holiday/peak shipping season with 80% more arrivals',
    params: {
      arrivalRateMultiplier: 1.8,
      dwellTimeMultiplier: 0.8,
      craneSpeedMultiplier: 1.0
    }
  },
  SLOW_SEASON: {
    id: 'slow_season',
    name: 'Slow Season',
    description: 'Reduced activity with 40% fewer arrivals',
    params: {
      arrivalRateMultiplier: 0.6,
      dwellTimeMultiplier: 1.2,
      craneSpeedMultiplier: 1.0
    }
  },
  CRANE_FAILURE: {
    id: 'crane_failure',
    name: 'Crane Failure',
    description: 'One crane offline - 50% reduced capacity',
    params: {
      arrivalRateMultiplier: 1.0,
      dwellTimeMultiplier: 1.0,
      craneSpeedMultiplier: 0.5
    }
  },
  RECEIVER_SURGE: {
    id: 'receiver_surge',
    name: 'Receiver Surge',
    description: 'Major receiver delays causing extended dwell times',
    params: {
      arrivalRateMultiplier: 1.0,
      dwellTimeMultiplier: 1.5,
      craneSpeedMultiplier: 1.0
    }
  },
  OPTIMAL: {
    id: 'optimal',
    name: 'Optimal Conditions',
    description: 'Best-case scenario with fast turnover',
    params: {
      arrivalRateMultiplier: 1.0,
      dwellTimeMultiplier: 0.6,
      craneSpeedMultiplier: 1.2
    }
  },
  CUSTOM: {
    id: 'custom',
    name: 'Custom Scenario',
    description: 'Define your own parameters',
    params: {
      arrivalRateMultiplier: 1.0,
      dwellTimeMultiplier: 1.0,
      craneSpeedMultiplier: 1.0
    }
  }
};

// Base arrival rate (containers per hour)
const BASE_ARRIVAL_RATE = 3;

// Base dwell time distribution (days)
const BASE_DWELL_DISTRIBUTION = {
  fast: { min: 1, max: 3, probability: 0.3 },
  medium: { min: 3, max: 7, probability: 0.5 },
  slow: { min: 7, max: 14, probability: 0.2 }
};

/**
 * Generate random dwell time based on distribution
 */
const generateDwellTime = (multiplier = 1.0) => {
  const rand = Math.random();
  let dist;
  
  if (rand < BASE_DWELL_DISTRIBUTION.fast.probability) {
    dist = BASE_DWELL_DISTRIBUTION.fast;
  } else if (rand < BASE_DWELL_DISTRIBUTION.fast.probability + BASE_DWELL_DISTRIBUTION.medium.probability) {
    dist = BASE_DWELL_DISTRIBUTION.medium;
  } else {
    dist = BASE_DWELL_DISTRIBUTION.slow;
  }
  
  const baseDwell = dist.min + Math.random() * (dist.max - dist.min);
  return Math.max(1, Math.round(baseDwell * multiplier));
};

/**
 * Generate container arrivals for simulation period
 */
export const generateArrivals = (params, simulationHours = 24) => {
  const { arrivalRateMultiplier = 1.0, dwellTimeMultiplier = 1.0 } = params;
  const arrivals = [];
  
  const adjustedRate = BASE_ARRIVAL_RATE * arrivalRateMultiplier;
  
  for (let hour = 0; hour < simulationHours; hour++) {
    // Poisson-like arrival distribution
    const expectedArrivals = adjustedRate * (0.5 + Math.random());
    const numArrivals = Math.round(expectedArrivals);
    
    for (let i = 0; i < numArrivals; i++) {
      arrivals.push({
        id: `SIM_${hour}_${i}_${Math.random().toString(36).substr(2, 6)}`,
        arrivalTime: hour * 60 + Math.floor(Math.random() * 60), // Minutes
        weight: 20 + Math.random() * 15, // 20-35 tons
        dwellDays: generateDwellTime(dwellTimeMultiplier)
      });
    }
  }
  
  // Sort by arrival time
  arrivals.sort((a, b) => a.arrivalTime - b.arrivalTime);
  
  return arrivals;
};

/**
 * Run a single simulation iteration
 */
export const runSingleSimulation = (initialGrid, arrivals, params) => {
  const grid = cloneGrid(initialGrid);
  const { craneSpeedMultiplier = 1.0 } = params;
  
  const results = {
    containersProcessed: 0,
    containersFailed: 0,
    waitTimes: [],
    utilizationSamples: [],
    energyUsed: 0
  };
  
  let currentTime = 0;
  let arrivalIndex = 0;
  
  // Simulate minute by minute
  const simulationMinutes = 24 * 60; // 24 hours
  
  while (currentTime < simulationMinutes) {
    // Process arrivals at this time
    while (arrivalIndex < arrivals.length && arrivals[arrivalIndex].arrivalTime <= currentTime) {
      const container = arrivals[arrivalIndex];
      const result = placeContainer(grid, container);
      
      if (result.success) {
        results.containersProcessed++;
        results.energyUsed += result.energy;
      } else {
        results.containersFailed++;
        results.waitTimes.push(10); // Penalty wait time for failed placement
      }
      
      arrivalIndex++;
    }
    
    // Advance time (crane speed affects how fast we can process)
    const timeStep = Math.ceil(5 / craneSpeedMultiplier);
    tick(grid, timeStep);
    currentTime += timeStep;
    
    // Sample utilization every hour
    if (currentTime % 60 === 0) {
      const stats = getGridStats(grid);
      results.utilizationSamples.push(stats.utilization);
    }
  }
  
  const finalStats = getGridStats(grid);
  
  return {
    ...results,
    finalUtilization: finalStats.utilization,
    peakUtilization: finalStats.peakUtilization,
    totalEnergy: finalStats.totalEnergy,
    avgUtilization: results.utilizationSamples.length > 0
      ? results.utilizationSamples.reduce((a, b) => a + b, 0) / results.utilizationSamples.length
      : 0,
    avgWaitTime: results.waitTimes.length > 0
      ? results.waitTimes.reduce((a, b) => a + b, 0) / results.waitTimes.length
      : 0
  };
};

/**
 * Run Monte Carlo simulation with multiple iterations
 */
export const runSimulation = (realGridState, scenarioParams, iterations = 50) => {
  const initialGrid = realGridState 
    ? initializeFromState(realGridState)
    : createVirtualGrid();
  
  const arrivals = generateArrivals(scenarioParams);
  const results = [];
  
  for (let i = 0; i < iterations; i++) {
    // Generate slightly different arrivals for each iteration
    const iterationArrivals = generateArrivals(scenarioParams);
    const result = runSingleSimulation(initialGrid, iterationArrivals, scenarioParams);
    results.push(result);
  }
  
  return aggregateResults(results, iterations);
};

/**
 * Aggregate results from multiple simulation runs
 */
export const aggregateResults = (results, iterations) => {
  const aggregate = {
    iterations,
    energy: {
      mean: 0,
      min: Infinity,
      max: -Infinity,
      std: 0
    },
    waitTime: {
      mean: 0,
      min: Infinity,
      max: -Infinity,
      std: 0
    },
    utilization: {
      mean: 0,
      peak: 0,
      min: Infinity,
      max: -Infinity
    },
    throughput: {
      processed: 0,
      failed: 0,
      successRate: 0
    }
  };
  
  // Calculate means
  results.forEach(r => {
    aggregate.energy.mean += r.totalEnergy;
    aggregate.energy.min = Math.min(aggregate.energy.min, r.totalEnergy);
    aggregate.energy.max = Math.max(aggregate.energy.max, r.totalEnergy);
    
    aggregate.waitTime.mean += r.avgWaitTime;
    aggregate.waitTime.min = Math.min(aggregate.waitTime.min, r.avgWaitTime);
    aggregate.waitTime.max = Math.max(aggregate.waitTime.max, r.avgWaitTime);
    
    aggregate.utilization.mean += r.avgUtilization;
    aggregate.utilization.peak = Math.max(aggregate.utilization.peak, r.peakUtilization);
    aggregate.utilization.min = Math.min(aggregate.utilization.min, r.avgUtilization);
    aggregate.utilization.max = Math.max(aggregate.utilization.max, r.avgUtilization);
    
    aggregate.throughput.processed += r.containersProcessed;
    aggregate.throughput.failed += r.containersFailed;
  });
  
  aggregate.energy.mean /= iterations;
  aggregate.waitTime.mean /= iterations;
  aggregate.utilization.mean /= iterations;
  aggregate.throughput.processed /= iterations;
  aggregate.throughput.failed /= iterations;
  aggregate.throughput.successRate = 
    aggregate.throughput.processed / (aggregate.throughput.processed + aggregate.throughput.failed) * 100;
  
  // Calculate standard deviations
  let energyVariance = 0;
  let waitVariance = 0;
  
  results.forEach(r => {
    energyVariance += Math.pow(r.totalEnergy - aggregate.energy.mean, 2);
    waitVariance += Math.pow(r.avgWaitTime - aggregate.waitTime.mean, 2);
  });
  
  aggregate.energy.std = Math.sqrt(energyVariance / iterations);
  aggregate.waitTime.std = Math.sqrt(waitVariance / iterations);
  
  // Round values for display
  aggregate.energy.mean = Math.round(aggregate.energy.mean * 100) / 100;
  aggregate.energy.min = Math.round(aggregate.energy.min * 100) / 100;
  aggregate.energy.max = Math.round(aggregate.energy.max * 100) / 100;
  aggregate.energy.std = Math.round(aggregate.energy.std * 100) / 100;
  
  aggregate.waitTime.mean = Math.round(aggregate.waitTime.mean * 10) / 10;
  aggregate.waitTime.min = Math.round(aggregate.waitTime.min * 10) / 10;
  aggregate.waitTime.max = Math.round(aggregate.waitTime.max * 10) / 10;
  aggregate.waitTime.std = Math.round(aggregate.waitTime.std * 10) / 10;
  
  aggregate.utilization.mean = Math.round(aggregate.utilization.mean);
  aggregate.utilization.peak = Math.round(aggregate.utilization.peak);
  aggregate.utilization.min = Math.round(aggregate.utilization.min);
  aggregate.utilization.max = Math.round(aggregate.utilization.max);
  
  aggregate.throughput.processed = Math.round(aggregate.throughput.processed);
  aggregate.throughput.failed = Math.round(aggregate.throughput.failed);
  aggregate.throughput.successRate = Math.round(aggregate.throughput.successRate);
  
  return aggregate;
};

/**
 * Compare two scenarios
 */
export const compareScenarios = (baselineResults, scenarioResults) => {
  const comparison = {
    energy: {
      baseline: baselineResults.energy.mean,
      scenario: scenarioResults.energy.mean,
      change: scenarioResults.energy.mean - baselineResults.energy.mean,
      changePercent: ((scenarioResults.energy.mean - baselineResults.energy.mean) / baselineResults.energy.mean * 100)
    },
    waitTime: {
      baseline: baselineResults.waitTime.mean,
      scenario: scenarioResults.waitTime.mean,
      change: scenarioResults.waitTime.mean - baselineResults.waitTime.mean,
      changePercent: baselineResults.waitTime.mean > 0 
        ? ((scenarioResults.waitTime.mean - baselineResults.waitTime.mean) / baselineResults.waitTime.mean * 100)
        : 0
    },
    utilization: {
      baseline: baselineResults.utilization.mean,
      scenario: scenarioResults.utilization.mean,
      change: scenarioResults.utilization.mean - baselineResults.utilization.mean,
      peakBaseline: baselineResults.utilization.peak,
      peakScenario: scenarioResults.utilization.peak
    },
    throughput: {
      baseline: baselineResults.throughput.successRate,
      scenario: scenarioResults.throughput.successRate,
      change: scenarioResults.throughput.successRate - baselineResults.throughput.successRate
    }
  };
  
  // Round percentages
  comparison.energy.changePercent = Math.round(comparison.energy.changePercent);
  comparison.waitTime.changePercent = Math.round(comparison.waitTime.changePercent);
  
  return comparison;
};

/**
 * Generate AI recommendation based on simulation results
 */
export const generateRecommendation = (comparison, scenarioName) => {
  const recommendations = [];
  
  // Energy analysis
  if (comparison.energy.changePercent > 30) {
    recommendations.push({
      type: 'WARNING',
      area: 'Energy',
      message: `${scenarioName} increases energy consumption by ${comparison.energy.changePercent}%`,
      suggestion: 'Consider optimizing placement algorithm or adding regenerative capacity'
    });
  }
  
  // Utilization analysis
  if (comparison.utilization.peakScenario > 90) {
    recommendations.push({
      type: 'CRITICAL',
      area: 'Capacity',
      message: `Peak utilization reaches ${comparison.utilization.peakScenario}% - near capacity`,
      suggestion: 'Expand grid capacity or implement overflow procedures'
    });
  }
  
  // Wait time analysis
  if (comparison.waitTime.scenario > 2) {
    recommendations.push({
      type: 'WARNING',
      area: 'Wait Time',
      message: `Average wait time increases to ${comparison.waitTime.scenario} minutes`,
      suggestion: 'Add additional crane or extend operating hours'
    });
  }
  
  // Throughput analysis
  if (comparison.throughput.scenario < 95) {
    recommendations.push({
      type: 'CRITICAL',
      area: 'Throughput',
      message: `Success rate drops to ${comparison.throughput.scenario}%`,
      suggestion: 'Grid cannot handle this load - consider capacity expansion'
    });
  }
  
  // Positive outcomes
  if (comparison.energy.changePercent < -10) {
    recommendations.push({
      type: 'POSITIVE',
      area: 'Energy',
      message: `Energy savings of ${Math.abs(comparison.energy.changePercent)}% possible`,
      suggestion: 'This scenario improves operational efficiency'
    });
  }
  
  if (recommendations.length === 0) {
    recommendations.push({
      type: 'POSITIVE',
      area: 'Overall',
      message: 'System can handle this scenario within normal parameters',
      suggestion: 'No immediate action required'
    });
  }
  
  return recommendations;
};

export default {
  SCENARIO_PRESETS,
  generateArrivals,
  runSingleSimulation,
  runSimulation,
  aggregateResults,
  compareScenarios,
  generateRecommendation
};
