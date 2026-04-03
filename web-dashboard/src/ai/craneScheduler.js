/**
 * Crane Scheduler - Multi-Crane AI Coordinator
 * 
 * AI Techniques:
 * - Greedy optimization with look-ahead
 * - Constraint satisfaction (collision avoidance)
 * - Task queue optimization
 */

// Crane movement speed (columns per minute)
const CRANE_SPEED = 2;

// Time to pick/place a container (minutes)
const PICK_PLACE_TIME = 1.5;

// Minimum safe distance between cranes (columns)
const SAFE_DISTANCE = 1;

/**
 * Initialize crane state
 */
export const initializeCranes = () => ({
  alpha: {
    id: 'alpha',
    name: 'Crane Alpha',
    grid: 'A',
    currentCol: 3,
    status: 'idle', // idle, moving, picking, placing
    currentTask: null,
    queue: [],
    totalMoves: 0,
    totalDistance: 0,
    utilizationMinutes: 0
  },
  beta: {
    id: 'beta',
    name: 'Crane Beta',
    grid: 'B',
    currentCol: 3,
    status: 'idle',
    currentTask: null,
    queue: [],
    totalMoves: 0,
    totalDistance: 0,
    utilizationMinutes: 0
  }
});

/**
 * Calculate travel time between columns
 */
export const calculateTravelTime = (fromCol, toCol) => {
  const distance = Math.abs(toCol - fromCol);
  return distance / CRANE_SPEED;
};

/**
 * Calculate total task completion time
 */
export const calculateTaskTime = (crane, task) => {
  const travelTime = calculateTravelTime(crane.currentCol, task.column);
  const operationTime = PICK_PLACE_TIME;
  return travelTime + operationTime;
};

/**
 * Check if two cranes will collide
 */
export const willCollide = (crane1, crane2, task1Col, task2Col) => {
  // If cranes are on different grids, no collision possible
  if (crane1.grid !== crane2.grid) return false;
  
  // Check if paths intersect
  const crane1Path = [crane1.currentCol, task1Col].sort((a, b) => a - b);
  const crane2Path = [crane2.currentCol, task2Col].sort((a, b) => a - b);
  
  // Check for overlap
  const overlap = !(crane1Path[1] < crane2Path[0] - SAFE_DISTANCE || 
                    crane2Path[1] < crane1Path[0] - SAFE_DISTANCE);
  
  return overlap;
};

/**
 * Score a crane for a given task (lower is better)
 */
export const scoreCraneForTask = (crane, task, otherCrane) => {
  // Base travel time score
  const travelTime = calculateTravelTime(crane.currentCol, task.column);
  
  // Queue penalty (each queued task adds delay)
  const queuePenalty = crane.queue.length * 3;
  
  // Busy penalty if crane is currently working
  const busyPenalty = crane.status !== 'idle' ? 5 : 0;
  
  // Grid preference (prefer crane already on same grid)
  const gridPenalty = crane.grid !== task.grid ? 10 : 0;
  
  // Collision risk penalty
  let collisionPenalty = 0;
  if (otherCrane && crane.grid === otherCrane.grid) {
    if (willCollide(crane, otherCrane, task.column, otherCrane.currentCol)) {
      collisionPenalty = 50;
    }
  }
  
  return {
    total: travelTime + queuePenalty + busyPenalty + gridPenalty + collisionPenalty,
    breakdown: {
      travelTime: Math.round(travelTime * 10) / 10,
      queuePenalty,
      busyPenalty,
      gridPenalty,
      collisionPenalty
    }
  };
};

/**
 * Assign optimal crane for a task
 */
export const assignCrane = (task, cranes) => {
  const craneArray = Object.values(cranes);
  
  const scores = craneArray.map(crane => {
    const otherCrane = craneArray.find(c => c.id !== crane.id);
    const score = scoreCraneForTask(crane, task, otherCrane);
    return { crane, ...score };
  });
  
  // Sort by total score (ascending)
  scores.sort((a, b) => a.total - b.total);
  
  return {
    assignedCrane: scores[0].crane,
    scores: scores,
    reason: generateAssignmentReason(scores[0])
  };
};

/**
 * Generate human-readable assignment reason
 */
const generateAssignmentReason = (score) => {
  const reasons = [];
  
  if (score.breakdown.travelTime < 1) {
    reasons.push('nearest crane');
  }
  if (score.breakdown.queuePenalty === 0) {
    reasons.push('empty queue');
  }
  if (score.breakdown.gridPenalty === 0) {
    reasons.push('same grid');
  }
  if (score.breakdown.collisionPenalty === 0) {
    reasons.push('no collision risk');
  }
  
  return reasons.length > 0 ? reasons.join(', ') : 'best available';
};

/**
 * Add task to crane queue
 */
export const addTaskToQueue = (cranes, craneId, task) => {
  const updatedCranes = { ...cranes };
  const crane = updatedCranes[craneId];
  
  const taskWithMeta = {
    ...task,
    id: `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    assignedAt: Date.now(),
    estimatedTime: calculateTaskTime(crane, task),
    status: 'queued'
  };
  
  crane.queue.push(taskWithMeta);
  
  return { cranes: updatedCranes, task: taskWithMeta };
};

/**
 * Process next task in crane queue
 */
export const processNextTask = (cranes, craneId) => {
  const updatedCranes = { ...cranes };
  const crane = updatedCranes[craneId];
  
  if (crane.queue.length === 0 || crane.status !== 'idle') {
    return { cranes: updatedCranes, task: null };
  }
  
  const task = crane.queue.shift();
  task.status = 'in_progress';
  task.startedAt = Date.now();
  
  crane.currentTask = task;
  crane.status = 'moving';
  crane.totalMoves++;
  crane.totalDistance += Math.abs(crane.currentCol - task.column);
  
  return { cranes: updatedCranes, task };
};

/**
 * Update crane position (called during animation)
 */
export const updateCranePosition = (cranes, craneId, newCol) => {
  const updatedCranes = { ...cranes };
  updatedCranes[craneId].currentCol = newCol;
  return updatedCranes;
};

/**
 * Complete current task
 */
export const completeTask = (cranes, craneId) => {
  const updatedCranes = { ...cranes };
  const crane = updatedCranes[craneId];
  
  if (!crane.currentTask) {
    return { cranes: updatedCranes, completedTask: null };
  }
  
  const completedTask = {
    ...crane.currentTask,
    status: 'completed',
    completedAt: Date.now(),
    actualTime: (Date.now() - crane.currentTask.startedAt) / 60000
  };
  
  crane.currentTask = null;
  crane.status = 'idle';
  crane.utilizationMinutes += completedTask.actualTime;
  
  return { cranes: updatedCranes, completedTask };
};

/**
 * Get crane utilization percentage
 */
export const getCraneUtilization = (crane, totalMinutes = 60) => {
  return Math.min(100, Math.round((crane.utilizationMinutes / totalMinutes) * 100));
};

/**
 * Optimize task queue order
 */
export const optimizeQueue = (crane) => {
  if (crane.queue.length < 2) return crane.queue;
  
  // Sort by proximity to current position (greedy nearest-neighbor)
  const optimized = [...crane.queue].sort((a, b) => {
    const distA = Math.abs(crane.currentCol - a.column);
    const distB = Math.abs(crane.currentCol - b.column);
    return distA - distB;
  });
  
  return optimized;
};

/**
 * Check for potential collisions in upcoming tasks
 */
export const detectPotentialCollisions = (cranes) => {
  const alpha = cranes.alpha;
  const beta = cranes.beta;
  
  if (alpha.grid !== beta.grid) return [];
  
  const collisions = [];
  
  // Check current tasks
  if (alpha.currentTask && beta.currentTask) {
    if (willCollide(alpha, beta, alpha.currentTask.column, beta.currentTask.column)) {
      collisions.push({
        type: 'ACTIVE',
        cranes: ['alpha', 'beta'],
        message: 'Active tasks may cause collision'
      });
    }
  }
  
  // Check queued tasks
  const alphaNext = alpha.queue[0];
  const betaNext = beta.queue[0];
  
  if (alphaNext && betaNext) {
    if (willCollide(alpha, beta, alphaNext.column, betaNext.column)) {
      collisions.push({
        type: 'QUEUED',
        cranes: ['alpha', 'beta'],
        message: 'Queued tasks may cause collision - reordering recommended'
      });
    }
  }
  
  return collisions;
};

/**
 * Generate crane status summary
 */
export const getCranesSummary = (cranes) => {
  const alpha = cranes.alpha;
  const beta = cranes.beta;
  
  return {
    alpha: {
      status: alpha.status,
      position: `Col ${alpha.currentCol}`,
      currentTask: alpha.currentTask?.containerId || null,
      queueLength: alpha.queue.length,
      utilization: getCraneUtilization(alpha),
      totalMoves: alpha.totalMoves
    },
    beta: {
      status: beta.status,
      position: `Col ${beta.currentCol}`,
      currentTask: beta.currentTask?.containerId || null,
      queueLength: beta.queue.length,
      utilization: getCraneUtilization(beta),
      totalMoves: beta.totalMoves
    },
    collisionWarnings: detectPotentialCollisions(cranes),
    totalQueuedTasks: alpha.queue.length + beta.queue.length
  };
};

export default {
  initializeCranes,
  calculateTravelTime,
  calculateTaskTime,
  willCollide,
  scoreCraneForTask,
  assignCrane,
  addTaskToQueue,
  processNextTask,
  updateCranePosition,
  completeTask,
  getCraneUtilization,
  optimizeQueue,
  detectPotentialCollisions,
  getCranesSummary
};
