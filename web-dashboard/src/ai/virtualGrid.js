/**
 * Virtual Grid - Simulation Model for What-If Scenarios
 * 
 * A lightweight grid simulation that mirrors the real grid
 * but can run independently for Monte Carlo simulations
 */

// Physics constants (matching real system)
const GRAVITY = 9.81;
const TIER_HEIGHT_METERS = 3.0;
const EFFICIENCY_LIFT = 0.85;
const EFFICIENCY_REGEN = 0.65;
const JOULES_TO_KWH = 2.77778e-7;

/**
 * Create a virtual grid for simulation
 */
export const createVirtualGrid = (config = {}) => {
  const {
    grids = ['A', 'B'],
    columns = 5,
    rows = 3,
    totalSlots = 30
  } = config;
  
  const slots = [];
  
  grids.forEach(gridName => {
    for (let col = 1; col <= columns; col++) {
      for (let row = 1; row <= rows; row++) {
        slots.push({
          id: `${gridName}${col}-${row}`,
          grid: gridName,
          column: col,
          row: row,
          status: 'available',
          containerId: null,
          weight: null,
          dwellDays: null,
          placedAt: null
        });
      }
    }
  });
  
  return {
    slots,
    totalSlots,
    totalEnergy: 0,
    totalMoves: 0,
    waitTimes: [],
    peakUtilization: 0,
    currentTime: 0, // Simulation time in minutes
    history: []
  };
};

/**
 * Calculate energy for a placement
 */
export const calculatePlacementEnergy = (weight, row) => {
  const massKg = weight * 1000;
  const height = (row - 1) * TIER_HEIGHT_METERS;
  
  const potentialEnergy = massKg * GRAVITY * height;
  const kwhIn = (potentialEnergy / EFFICIENCY_LIFT) * JOULES_TO_KWH;
  const kwhOut = (potentialEnergy * EFFICIENCY_REGEN) * JOULES_TO_KWH;
  
  return kwhIn - kwhOut;
};

/**
 * Get optimal row for a container based on dwell time
 */
export const getOptimalRow = (dwellDays) => {
  if (dwellDays < 3) return 1;  // Fast mover -> bottom
  if (dwellDays > 7) return 3;  // Slow mover -> top
  return 2;                      // Medium -> middle
};

/**
 * Find best available slot for a container
 */
export const findBestSlot = (grid, container) => {
  const optimalRow = getOptimalRow(container.dwellDays);
  const availableSlots = grid.slots.filter(s => s.status === 'available');
  
  if (availableSlots.length === 0) return null;
  
  // Score slots (lower is better)
  const scoredSlots = availableSlots.map(slot => {
    const rowPenalty = Math.abs(slot.row - optimalRow) * 10;
    const energyCost = calculatePlacementEnergy(container.weight, slot.row);
    return { slot, score: rowPenalty + energyCost };
  });
  
  scoredSlots.sort((a, b) => a.score - b.score);
  return scoredSlots[0].slot;
};

/**
 * Place a container in the grid
 */
export const placeContainer = (grid, container) => {
  const slot = findBestSlot(grid, container);
  
  if (!slot) {
    return { success: false, reason: 'GRID_FULL', grid };
  }
  
  const slotIndex = grid.slots.findIndex(s => s.id === slot.id);
  const energy = calculatePlacementEnergy(container.weight, slot.row);
  
  grid.slots[slotIndex] = {
    ...slot,
    status: 'occupied',
    containerId: container.id,
    weight: container.weight,
    dwellDays: container.dwellDays,
    placedAt: grid.currentTime
  };
  
  grid.totalEnergy += energy;
  grid.totalMoves++;
  
  // Update peak utilization
  const currentUtil = getUtilization(grid);
  grid.peakUtilization = Math.max(grid.peakUtilization, currentUtil);
  
  grid.history.push({
    type: 'PLACE',
    containerId: container.id,
    slotId: slot.id,
    energy,
    time: grid.currentTime
  });
  
  return { success: true, slot, energy, grid };
};

/**
 * Remove a container from the grid
 */
export const removeContainer = (grid, containerId) => {
  const slotIndex = grid.slots.findIndex(s => s.containerId === containerId);
  
  if (slotIndex === -1) {
    return { success: false, reason: 'NOT_FOUND', grid };
  }
  
  const slot = grid.slots[slotIndex];
  const retrievalEnergy = calculatePlacementEnergy(slot.weight, slot.row) * 0.8; // Retrieval uses less energy
  
  grid.slots[slotIndex] = {
    ...slot,
    status: 'available',
    containerId: null,
    weight: null,
    dwellDays: null,
    placedAt: null
  };
  
  grid.totalEnergy += retrievalEnergy;
  grid.totalMoves++;
  
  grid.history.push({
    type: 'REMOVE',
    containerId,
    slotId: slot.id,
    energy: retrievalEnergy,
    time: grid.currentTime
  });
  
  return { success: true, slot, energy: retrievalEnergy, grid };
};

/**
 * Advance simulation time
 */
export const tick = (grid, minutes = 1) => {
  grid.currentTime += minutes;
  
  // Check for containers that should depart
  const departures = [];
  grid.slots.forEach((slot, index) => {
    if (slot.status === 'occupied' && slot.placedAt !== null) {
      const timeInGrid = grid.currentTime - slot.placedAt;
      const dwellMinutes = slot.dwellDays * 24 * 60;
      
      if (timeInGrid >= dwellMinutes) {
        departures.push(slot.containerId);
      }
    }
  });
  
  // Process departures
  departures.forEach(containerId => {
    removeContainer(grid, containerId);
  });
  
  return { grid, departures };
};

/**
 * Get current utilization percentage
 */
export const getUtilization = (grid) => {
  const occupied = grid.slots.filter(s => s.status === 'occupied').length;
  return (occupied / grid.totalSlots) * 100;
};

/**
 * Get grid statistics
 */
export const getGridStats = (grid) => {
  const occupied = grid.slots.filter(s => s.status === 'occupied');
  
  return {
    utilization: getUtilization(grid),
    peakUtilization: grid.peakUtilization,
    totalEnergy: Math.round(grid.totalEnergy * 1000) / 1000,
    totalMoves: grid.totalMoves,
    avgEnergyPerMove: grid.totalMoves > 0 
      ? Math.round((grid.totalEnergy / grid.totalMoves) * 1000) / 1000 
      : 0,
    occupiedSlots: occupied.length,
    availableSlots: grid.totalSlots - occupied.length,
    tierDistribution: {
      row1: occupied.filter(s => s.row === 1).length,
      row2: occupied.filter(s => s.row === 2).length,
      row3: occupied.filter(s => s.row === 3).length
    }
  };
};

/**
 * Clone a grid for parallel simulations
 */
export const cloneGrid = (grid) => {
  return {
    slots: grid.slots.map(s => ({ ...s })),
    totalSlots: grid.totalSlots,
    totalEnergy: grid.totalEnergy,
    totalMoves: grid.totalMoves,
    waitTimes: [...grid.waitTimes],
    peakUtilization: grid.peakUtilization,
    currentTime: grid.currentTime,
    history: [...grid.history]
  };
};

/**
 * Initialize grid with existing state
 */
export const initializeFromState = (realGridState) => {
  const grid = createVirtualGrid();
  
  realGridState.forEach(slot => {
    if (slot.status === 'occupied') {
      const virtualSlot = grid.slots.find(s => s.id === slot.id);
      if (virtualSlot) {
        const index = grid.slots.indexOf(virtualSlot);
        grid.slots[index] = {
          ...virtualSlot,
          status: 'occupied',
          containerId: slot.containerId,
          weight: slot.weight || 25,
          dwellDays: slot.dwellDays || 5,
          placedAt: 0
        };
      }
    }
  });
  
  return grid;
};

export default {
  createVirtualGrid,
  calculatePlacementEnergy,
  getOptimalRow,
  findBestSlot,
  placeContainer,
  removeContainer,
  tick,
  getUtilization,
  getGridStats,
  cloneGrid,
  initializeFromState
};
