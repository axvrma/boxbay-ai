import React, { useState, useEffect, useCallback } from 'react';
import {
  initializeCranes,
  assignCrane,
  addTaskToQueue,
  processNextTask,
  completeTask,
  getCranesSummary,
  calculateTaskTime
} from '../ai/craneScheduler';

const CraneStatus = ({ crane, isActive }) => {
  const statusColors = {
    idle: { bg: '#f0fdf4', border: '#86efac', text: '#166534' },
    moving: { bg: '#eff6ff', border: '#93c5fd', text: '#1e40af' },
    picking: { bg: '#fef3c7', border: '#fcd34d', text: '#92400e' },
    placing: { bg: '#fef3c7', border: '#fcd34d', text: '#92400e' }
  };

  const colors = statusColors[crane.status] || statusColors.idle;

  return (
    <div style={{
      flex: 1,
      padding: '16px',
      borderRadius: '12px',
      background: colors.bg,
      border: `2px solid ${colors.border}`,
      transition: 'all 0.3s ease'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '1.5rem' }}>🏗️</span>
          <span style={{ fontWeight: '700', color: '#0f172a', fontSize: '1rem' }}>{crane.name}</span>
        </div>
        <span style={{
          padding: '4px 10px',
          borderRadius: '12px',
          fontSize: '0.7rem',
          fontWeight: '600',
          background: colors.border,
          color: colors.text,
          textTransform: 'uppercase'
        }}>
          {crane.status}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '0.8rem' }}>
        <div>
          <span style={{ color: '#64748b' }}>Position:</span>
          <span style={{ marginLeft: '4px', fontWeight: '600', color: '#0f172a' }}>Col {crane.currentCol}</span>
        </div>
        <div>
          <span style={{ color: '#64748b' }}>Grid:</span>
          <span style={{ marginLeft: '4px', fontWeight: '600', color: '#0f172a' }}>{crane.grid}</span>
        </div>
        <div>
          <span style={{ color: '#64748b' }}>Queue:</span>
          <span style={{ marginLeft: '4px', fontWeight: '600', color: crane.queue.length > 2 ? '#dc2626' : '#0f172a' }}>
            {crane.queue.length} tasks
          </span>
        </div>
        <div>
          <span style={{ color: '#64748b' }}>Moves:</span>
          <span style={{ marginLeft: '4px', fontWeight: '600', color: '#0f172a' }}>{crane.totalMoves}</span>
        </div>
      </div>

      {crane.currentTask && (
        <div style={{
          marginTop: '12px',
          padding: '10px',
          background: '#ffffff',
          borderRadius: '8px',
          border: '1px solid #e2e8f0'
        }}>
          <div style={{ fontSize: '0.7rem', color: '#64748b', marginBottom: '4px' }}>Current Task</div>
          <div style={{ fontWeight: '600', color: '#0f172a', fontSize: '0.85rem' }}>
            {crane.currentTask.containerId}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
            → Col {crane.currentTask.column}
          </div>
        </div>
      )}
    </div>
  );
};

const TaskQueueItem = ({ task, index, isOptimal }) => (
  <div style={{
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 14px',
    background: task.status === 'in_progress' ? '#eff6ff' : '#ffffff',
    borderRadius: '8px',
    border: `1px solid ${task.status === 'in_progress' ? '#93c5fd' : '#e2e8f0'}`,
    marginBottom: '8px'
  }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
      <span style={{
        width: '24px',
        height: '24px',
        borderRadius: '50%',
        background: task.status === 'in_progress' ? '#3b82f6' : '#e2e8f0',
        color: task.status === 'in_progress' ? '#ffffff' : '#64748b',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '0.75rem',
        fontWeight: '600'
      }}>
        {index + 1}
      </span>
      <div>
        <div style={{ fontWeight: '600', color: '#0f172a', fontSize: '0.85rem' }}>
          {task.containerId}
        </div>
        <div style={{ fontSize: '0.7rem', color: '#64748b' }}>
          Grid {task.grid} → Col {task.column}
        </div>
      </div>
    </div>
    <div style={{ textAlign: 'right' }}>
      <div style={{ fontWeight: '600', color: '#0f172a', fontSize: '0.85rem' }}>
        {task.estimatedTime?.toFixed(1)} min
      </div>
      {isOptimal && (
        <span style={{ fontSize: '0.65rem', color: '#10b981' }}>⚡ Optimal</span>
      )}
    </div>
  </div>
);

const CraneCoordinator = ({ gridState = [], onCraneMove, addLog }) => {
  const [cranes, setCranes] = useState(() => initializeCranes());
  const [taskQueue, setTaskQueue] = useState([]);
  const [isAutoMode, setIsAutoMode] = useState(true);
  const [collisionWarnings, setCollisionWarnings] = useState([]);

  // Get occupied containers that could be retrieved
  const availableContainers = gridState.filter(s => 
    s.status === 'occupied' && 
    !taskQueue.some(t => t.containerId === s.containerId)
  );

  // Process crane tasks automatically
  useEffect(() => {
    if (!isAutoMode) return;

    const interval = setInterval(() => {
      setCranes(prevCranes => {
        let updated = { ...prevCranes };

        // Process each crane
        ['alpha', 'beta'].forEach(craneId => {
          const crane = updated[craneId];

          if (crane.status === 'idle' && crane.queue.length > 0) {
            // Start next task
            const result = processNextTask(updated, craneId);
            updated = result.cranes;
            
            if (result.task && addLog) {
              addLog(`🏗️ ${crane.name} starting task: ${result.task.containerId}`);
            }
          } else if (crane.status === 'moving' && crane.currentTask) {
            // Simulate movement
            const targetCol = crane.currentTask.column;
            const direction = targetCol > crane.currentCol ? 1 : targetCol < crane.currentCol ? -1 : 0;
            
            if (direction !== 0) {
              updated[craneId] = {
                ...crane,
                currentCol: crane.currentCol + direction * 0.5
              };
            } else {
              // Arrived at destination
              updated[craneId] = { ...crane, status: 'picking' };
            }
          } else if (crane.status === 'picking') {
            // Complete the task after a brief delay
            const result = completeTask(updated, craneId);
            updated = result.cranes;
            
            if (result.completedTask && addLog) {
              addLog(`✅ ${crane.name} completed: ${result.completedTask.containerId}`);
            }
          }
        });

        // Check for collision warnings
        const summary = getCranesSummary(updated);
        setCollisionWarnings(summary.collisionWarnings);

        return updated;
      });
    }, 500);

    return () => clearInterval(interval);
  }, [isAutoMode, addLog]);

  // Add a retrieval task
  const addRetrievalTask = useCallback((container) => {
    const task = {
      type: 'RETRIEVE',
      containerId: container.containerId,
      grid: container.grid,
      column: container.column,
      row: container.row,
      weight: container.weight
    };

    // Use AI to assign optimal crane
    const assignment = assignCrane(task, cranes);
    const craneId = assignment.assignedCrane.id;

    setCranes(prevCranes => {
      const result = addTaskToQueue(prevCranes, craneId, task);
      return result.cranes;
    });

    setTaskQueue(prev => [...prev, { ...task, assignedTo: craneId }]);

    if (addLog) {
      addLog(`📋 Task assigned to ${assignment.assignedCrane.name}: ${task.containerId} (${assignment.reason})`);
    }
  }, [cranes, addLog]);

  // Get all queued tasks across both cranes
  const allTasks = [
    ...cranes.alpha.queue.map(t => ({ ...t, crane: 'alpha' })),
    ...cranes.beta.queue.map(t => ({ ...t, crane: 'beta' }))
  ];

  // Add current tasks if any
  if (cranes.alpha.currentTask) {
    allTasks.unshift({ ...cranes.alpha.currentTask, crane: 'alpha', status: 'in_progress' });
  }
  if (cranes.beta.currentTask) {
    allTasks.unshift({ ...cranes.beta.currentTask, crane: 'beta', status: 'in_progress' });
  }

  const summary = getCranesSummary(cranes);

  return (
    <div style={{
      background: '#ffffff',
      borderRadius: '16px',
      padding: '24px',
      border: '1px solid #e2e8f0',
      boxShadow: '0 1px 3px 0 rgb(0 0 0 / 0.1)'
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h3 style={{ margin: 0, color: '#0f172a', fontSize: '1.1rem', fontWeight: '600' }}>
            Crane Coordination
          </h3>
          <p style={{ margin: '4px 0 0 0', fontSize: '0.75rem', color: '#64748b' }}>
            AI-optimized dual-crane task assignment
          </p>
        </div>
        <button
          onClick={() => setIsAutoMode(!isAutoMode)}
          style={{
            padding: '8px 16px',
            background: isAutoMode 
              ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)'
              : '#e2e8f0',
            color: isAutoMode ? '#ffffff' : '#64748b',
            border: 'none',
            borderRadius: '8px',
            fontSize: '0.8rem',
            fontWeight: '600',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}
        >
          <span style={{ 
            width: '8px', 
            height: '8px', 
            borderRadius: '50%', 
            background: isAutoMode ? '#ffffff' : '#94a3b8',
            animation: isAutoMode ? 'pulse 1.5s infinite' : 'none'
          }} />
          {isAutoMode ? 'AI Mode' : 'Paused'}
        </button>
      </div>

      {/* Collision Warning */}
      {collisionWarnings.length > 0 && (
        <div style={{
          padding: '12px 16px',
          background: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)',
          borderRadius: '10px',
          border: '1px solid #f59e0b',
          marginBottom: '16px',
          display: 'flex',
          alignItems: 'center',
          gap: '10px'
        }}>
          <span style={{ fontSize: '1.25rem' }}>⚠️</span>
          <div>
            <div style={{ fontWeight: '600', color: '#92400e', fontSize: '0.85rem' }}>
              Collision Risk Detected
            </div>
            <div style={{ fontSize: '0.75rem', color: '#a16207' }}>
              {collisionWarnings[0].message}
            </div>
          </div>
        </div>
      )}

      {/* Crane Status Cards */}
      <div style={{ display: 'flex', gap: '16px', marginBottom: '20px' }}>
        <CraneStatus crane={cranes.alpha} isActive={cranes.alpha.status !== 'idle'} />
        <CraneStatus crane={cranes.beta} isActive={cranes.beta.status !== 'idle'} />
      </div>

      {/* Task Queue */}
      <div style={{ marginBottom: '16px' }}>
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          marginBottom: '12px'
        }}>
          <span style={{ fontSize: '0.85rem', fontWeight: '600', color: '#0f172a' }}>
            Task Queue ({allTasks.length})
          </span>
          <span style={{ fontSize: '0.7rem', color: '#64748b' }}>
            AI Optimized Order
          </span>
        </div>

        <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
          {allTasks.length === 0 ? (
            <div style={{
              textAlign: 'center',
              padding: '24px',
              background: '#f8fafc',
              borderRadius: '10px',
              border: '1px dashed #e2e8f0'
            }}>
              <span style={{ fontSize: '1.5rem' }}>📋</span>
              <div style={{ color: '#64748b', fontSize: '0.85rem', marginTop: '8px' }}>
                No tasks in queue
              </div>
            </div>
          ) : (
            allTasks.map((task, i) => (
              <TaskQueueItem 
                key={task.id || i} 
                task={task} 
                index={i}
                isOptimal={i === 0}
              />
            ))
          )}
        </div>
      </div>

      {/* Quick Add Task */}
      <div>
        <div style={{ fontSize: '0.85rem', fontWeight: '600', color: '#0f172a', marginBottom: '10px' }}>
          Quick Add Retrieval
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          {availableContainers.slice(0, 6).map(container => (
            <button
              key={container.containerId}
              onClick={() => addRetrievalTask(container)}
              style={{
                padding: '6px 12px',
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '6px',
                fontSize: '0.75rem',
                fontWeight: '500',
                color: '#475569',
                cursor: 'pointer',
                transition: 'all 0.2s ease'
              }}
              onMouseOver={e => {
                e.target.style.background = '#e0f2fe';
                e.target.style.borderColor = '#7dd3fc';
              }}
              onMouseOut={e => {
                e.target.style.background = '#f8fafc';
                e.target.style.borderColor = '#e2e8f0';
              }}
            >
              {container.containerId}
            </button>
          ))}
          {availableContainers.length === 0 && (
            <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
              No containers available
            </span>
          )}
        </div>
      </div>

      {/* Stats Footer */}
      <div style={{
        marginTop: '16px',
        paddingTop: '16px',
        borderTop: '1px solid #e2e8f0',
        display: 'flex',
        justifyContent: 'space-around',
        fontSize: '0.75rem'
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ color: '#64748b' }}>Total Moves</div>
          <div style={{ fontWeight: '700', color: '#0f172a', fontSize: '1rem' }}>
            {summary.alpha.totalMoves + summary.beta.totalMoves}
          </div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ color: '#64748b' }}>Alpha Util</div>
          <div style={{ fontWeight: '700', color: '#0f172a', fontSize: '1rem' }}>
            {summary.alpha.utilization}%
          </div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ color: '#64748b' }}>Beta Util</div>
          <div style={{ fontWeight: '700', color: '#0f172a', fontSize: '1rem' }}>
            {summary.beta.utilization}%
          </div>
        </div>
      </div>
    </div>
  );
};

export default CraneCoordinator;
