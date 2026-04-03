import React, { useState, useEffect, useMemo } from 'react';
import {
  detectAllAnomalies,
  generateAnomalyHistory
} from '../ai/anomalyEngine';

const SeverityBadge = ({ severity }) => {
  const config = {
    CRITICAL: { bg: '#fef2f2', border: '#fecaca', text: '#dc2626', icon: '🔴' },
    HIGH: { bg: '#fff7ed', border: '#fed7aa', text: '#ea580c', icon: '🟠' },
    MEDIUM: { bg: '#fefce8', border: '#fef08a', text: '#ca8a04', icon: '🟡' },
    LOW: { bg: '#f0fdf4', border: '#bbf7d0', text: '#16a34a', icon: '🟢' }
  };

  const c = config[severity] || config.LOW;

  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '4px',
      padding: '3px 8px',
      borderRadius: '10px',
      fontSize: '0.65rem',
      fontWeight: '600',
      background: c.bg,
      border: `1px solid ${c.border}`,
      color: c.text
    }}>
      <span>{c.icon}</span>
      {severity}
    </span>
  );
};

const HealthGauge = ({ score }) => {
  const getColor = (s) => {
    if (s >= 80) return '#10b981';
    if (s >= 60) return '#f59e0b';
    if (s >= 40) return '#f97316';
    return '#ef4444';
  };

  const color = getColor(score);

  return (
    <div style={{ marginBottom: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <span style={{ fontSize: '0.85rem', fontWeight: '600', color: '#0f172a' }}>System Health</span>
        <span style={{ fontSize: '1.25rem', fontWeight: '700', color }}>{score}%</span>
      </div>
      <div style={{
        height: '10px',
        background: '#e2e8f0',
        borderRadius: '5px',
        overflow: 'hidden'
      }}>
        <div style={{
          height: '100%',
          width: `${score}%`,
          background: `linear-gradient(90deg, ${color} 0%, ${color}dd 100%)`,
          borderRadius: '5px',
          transition: 'width 0.5s ease, background 0.5s ease'
        }} />
      </div>
    </div>
  );
};

const AlertCard = ({ anomaly, isExpanded, onToggle }) => {
  const severityColors = {
    CRITICAL: { bg: '#fef2f2', border: '#fecaca', accent: '#dc2626' },
    HIGH: { bg: '#fff7ed', border: '#fed7aa', accent: '#ea580c' },
    MEDIUM: { bg: '#fefce8', border: '#fef08a', accent: '#ca8a04' },
    LOW: { bg: '#f0fdf4', border: '#bbf7d0', accent: '#16a34a' }
  };

  const colors = severityColors[anomaly.severity] || severityColors.LOW;

  return (
    <div
      style={{
        background: colors.bg,
        border: `1px solid ${colors.border}`,
        borderRadius: '12px',
        marginBottom: '10px',
        overflow: 'hidden',
        cursor: 'pointer',
        transition: 'all 0.2s ease'
      }}
      onClick={onToggle}
    >
      <div style={{ padding: '14px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
              <SeverityBadge severity={anomaly.severity} />
              <span style={{ fontSize: '0.65rem', color: '#94a3b8' }}>
                {new Date(anomaly.timestamp).toLocaleTimeString()}
              </span>
            </div>
            <div style={{ fontWeight: '600', color: '#0f172a', fontSize: '0.9rem' }}>
              {anomaly.title}
            </div>
            <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '4px' }}>
              {anomaly.message}
            </div>
          </div>
          <span style={{
            transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s ease',
            color: '#94a3b8'
          }}>
            ▼
          </span>
        </div>
      </div>

      {isExpanded && (
        <div style={{
          padding: '12px 16px',
          borderTop: `1px solid ${colors.border}`,
          background: '#ffffff'
        }}>
          <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '8px' }}>
            <strong>Recommendation:</strong>
          </div>
          <div style={{
            padding: '10px 14px',
            background: '#f8fafc',
            borderRadius: '8px',
            fontSize: '0.8rem',
            color: '#475569',
            borderLeft: `3px solid ${colors.accent}`
          }}>
            {anomaly.recommendation}
          </div>
          {anomaly.value !== undefined && (
            <div style={{ marginTop: '10px', display: 'flex', gap: '16px', fontSize: '0.75rem' }}>
              <div>
                <span style={{ color: '#94a3b8' }}>Current: </span>
                <span style={{ fontWeight: '600', color: '#0f172a' }}>{anomaly.value}</span>
              </div>
              {anomaly.expected !== undefined && (
                <div>
                  <span style={{ color: '#94a3b8' }}>Expected: </span>
                  <span style={{ fontWeight: '600', color: '#0f172a' }}>{anomaly.expected}</span>
                </div>
              )}
              {anomaly.zScore !== undefined && (
                <div>
                  <span style={{ color: '#94a3b8' }}>Z-Score: </span>
                  <span style={{ fontWeight: '600', color: colors.accent }}>{anomaly.zScore}σ</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const TimelineBar = ({ history }) => {
  const hours = 24;
  const barWidth = 100 / hours;

  return (
    <div style={{ marginTop: '16px' }}>
      <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '8px' }}>
        Anomaly History (24h)
      </div>
      <div style={{
        display: 'flex',
        height: '32px',
        background: '#f8fafc',
        borderRadius: '6px',
        overflow: 'hidden',
        border: '1px solid #e2e8f0'
      }}>
        {Array.from({ length: hours }).map((_, i) => {
          const hourAnomalies = history.filter(h => {
            const hourDiff = Math.floor((Date.now() - h.timestamp) / (1000 * 60 * 60));
            return hourDiff === (hours - 1 - i);
          });

          const hasAnomaly = hourAnomalies.length > 0;
          const maxSeverity = hourAnomalies.reduce((max, h) => {
            const order = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
            return order[h.severity] > order[max] ? h.severity : max;
          }, 'LOW');

          const colors = {
            CRITICAL: '#ef4444',
            HIGH: '#f97316',
            MEDIUM: '#f59e0b',
            LOW: '#10b981'
          };

          return (
            <div
              key={i}
              style={{
                width: `${barWidth}%`,
                height: '100%',
                background: hasAnomaly ? colors[maxSeverity] : 'transparent',
                borderRight: i < hours - 1 ? '1px solid #e2e8f0' : 'none',
                opacity: hasAnomaly ? (hourAnomalies[0]?.resolved ? 0.4 : 1) : 1,
                transition: 'background 0.3s ease'
              }}
              title={hasAnomaly ? `${hourAnomalies.length} anomaly(s)` : 'No anomalies'}
            />
          );
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px', fontSize: '0.65rem', color: '#94a3b8' }}>
        <span>24h ago</span>
        <span>Now</span>
      </div>
    </div>
  );
};

const AnomalyDetector = ({ gridState = [], energyData, metrics }) => {
  const [expandedId, setExpandedId] = useState(null);
  const [history, setHistory] = useState([]);

  // Run anomaly detection
  const detection = useMemo(() => {
    return detectAllAnomalies(gridState, energyData, metrics);
  }, [gridState, energyData, metrics]);

  // Generate history on mount
  useEffect(() => {
    setHistory(generateAnomalyHistory(24));
  }, []);

  // Add current anomalies to history
  useEffect(() => {
    if (detection.anomalies.length > 0) {
      setHistory(prev => {
        const newHistory = [...prev];
        detection.anomalies.forEach(a => {
          if (!newHistory.some(h => h.type === a.type && Date.now() - h.timestamp < 60000)) {
            newHistory.push({
              timestamp: a.timestamp,
              type: a.type,
              severity: a.severity,
              resolved: false
            });
          }
        });
        return newHistory.slice(-50); // Keep last 50
      });
    }
  }, [detection]);

  const toggleExpand = (id) => {
    setExpandedId(expandedId === id ? null : id);
  };

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
            Anomaly Detection
          </h3>
          <p style={{ margin: '4px 0 0 0', fontSize: '0.75rem', color: '#64748b' }}>
            AI-powered operational monitoring
          </p>
        </div>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '6px 12px',
          background: '#f0fdf4',
          borderRadius: '20px',
          border: '1px solid #86efac'
        }}>
          <span style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: '#10b981',
            animation: 'pulse 2s infinite'
          }} />
          <span style={{ fontSize: '0.75rem', fontWeight: '600', color: '#166534' }}>Live</span>
        </div>
      </div>

      {/* Health Gauge */}
      <HealthGauge score={detection.healthScore} />

      {/* Summary Stats */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: '8px',
        marginBottom: '20px'
      }}>
        {[
          { label: 'Critical', count: detection.summary.critical, color: '#dc2626' },
          { label: 'High', count: detection.summary.high, color: '#ea580c' },
          { label: 'Medium', count: detection.summary.medium, color: '#ca8a04' },
          { label: 'Low', count: detection.summary.low, color: '#16a34a' }
        ].map(stat => (
          <div key={stat.label} style={{
            textAlign: 'center',
            padding: '10px',
            background: '#f8fafc',
            borderRadius: '8px',
            border: '1px solid #e2e8f0'
          }}>
            <div style={{ fontSize: '1.25rem', fontWeight: '700', color: stat.color }}>
              {stat.count}
            </div>
            <div style={{ fontSize: '0.65rem', color: '#64748b' }}>{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Active Alerts */}
      <div style={{ marginBottom: '16px' }}>
        <div style={{ fontSize: '0.85rem', fontWeight: '600', color: '#0f172a', marginBottom: '12px' }}>
          Active Alerts ({detection.anomalies.length})
        </div>

        <div style={{ maxHeight: '280px', overflowY: 'auto' }}>
          {detection.anomalies.length === 0 ? (
            <div style={{
              textAlign: 'center',
              padding: '32px 20px',
              background: '#f0fdf4',
              borderRadius: '12px',
              border: '1px solid #86efac'
            }}>
              <span style={{ fontSize: '2rem' }}>✅</span>
              <div style={{ color: '#166534', fontSize: '0.9rem', fontWeight: '600', marginTop: '8px' }}>
                All Systems Normal
              </div>
              <div style={{ color: '#15803d', fontSize: '0.75rem', marginTop: '4px' }}>
                No anomalies detected
              </div>
            </div>
          ) : (
            detection.anomalies.map(anomaly => (
              <AlertCard
                key={anomaly.id}
                anomaly={anomaly}
                isExpanded={expandedId === anomaly.id}
                onToggle={() => toggleExpand(anomaly.id)}
              />
            ))
          )}
        </div>
      </div>

      {/* Timeline */}
      <TimelineBar history={history} />
    </div>
  );
};

export default AnomalyDetector;
