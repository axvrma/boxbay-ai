import React, { useState, useEffect, useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import {
  generateForecastReport,
  predictArrivals,
  getDeparturesDueToday
} from '../ai/forecastEngine';

const StatCard = ({ icon, label, value, subtext, color = '#3b82f6' }) => (
  <div style={{
    flex: 1,
    padding: '16px',
    background: `linear-gradient(135deg, ${color}10 0%, ${color}05 100%)`,
    borderRadius: '12px',
    border: `1px solid ${color}30`,
    textAlign: 'center'
  }}>
    <div style={{ fontSize: '1.5rem', marginBottom: '4px' }}>{icon}</div>
    <div style={{ fontSize: '1.5rem', fontWeight: '700', color }}>{value}</div>
    <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: '500' }}>{label}</div>
    {subtext && (
      <div style={{ fontSize: '0.65rem', color: '#94a3b8', marginTop: '2px' }}>{subtext}</div>
    )}
  </div>
);

const ConfidenceBadge = ({ confidence }) => {
  const getColor = (c) => {
    if (c >= 85) return { bg: '#f0fdf4', border: '#86efac', text: '#166534' };
    if (c >= 70) return { bg: '#fefce8', border: '#fef08a', text: '#854d0e' };
    return { bg: '#fef2f2', border: '#fecaca', text: '#991b1b' };
  };

  const colors = getColor(confidence);

  return (
    <span style={{
      padding: '4px 10px',
      borderRadius: '12px',
      fontSize: '0.7rem',
      fontWeight: '600',
      background: colors.bg,
      border: `1px solid ${colors.border}`,
      color: colors.text
    }}>
      {confidence}% confidence
    </span>
  );
};

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload || !payload.length) return null;

  return (
    <div style={{
      background: '#ffffff',
      border: '1px solid #e2e8f0',
      borderRadius: '8px',
      padding: '12px',
      boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'
    }}>
      <div style={{ fontWeight: '600', color: '#0f172a', marginBottom: '4px' }}>{label}</div>
      <div style={{ fontSize: '0.85rem', color: '#3b82f6' }}>
        Predicted: <strong>{payload[0].value}</strong> containers
      </div>
      {payload[0].payload.confidence && (
        <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '4px' }}>
          Confidence: {Math.round(payload[0].payload.confidence * 100)}%
        </div>
      )}
    </div>
  );
};

const PredictiveAnalytics = ({ gridState = [], currentUtilization = 0 }) => {
  const [timeRange, setTimeRange] = useState(24);
  const [historicalData] = useState([]); // Would come from backend in production

  // Generate forecast
  const forecast = useMemo(() => {
    return generateForecastReport(historicalData, gridState, currentUtilization);
  }, [historicalData, gridState, currentUtilization]);

  // Prepare chart data
  const chartData = useMemo(() => {
    return forecast.predictions.slice(0, timeRange).map(p => ({
      ...p,
      name: p.label,
      arrivals: p.predicted
    }));
  }, [forecast, timeRange]);

  // Find capacity warning
  const capacityWarning = forecast.capacityProjection.find(c => c.utilization >= 90);

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
            Predictive Analytics
          </h3>
          <p style={{ margin: '4px 0 0 0', fontSize: '0.75rem', color: '#64748b' }}>
            AI-powered arrival forecasting
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <ConfidenceBadge confidence={forecast.summary.avgConfidence} />
          <select
            value={timeRange}
            onChange={(e) => setTimeRange(parseInt(e.target.value))}
            style={{
              padding: '6px 12px',
              borderRadius: '8px',
              border: '1px solid #e2e8f0',
              fontSize: '0.8rem',
              color: '#475569',
              background: '#f8fafc',
              cursor: 'pointer'
            }}
          >
            <option value={12}>12h</option>
            <option value={24}>24h</option>
            <option value={48}>48h</option>
          </select>
        </div>
      </div>

      {/* Forecast Chart */}
      <div style={{ marginBottom: '20px' }}>
        <div style={{ fontSize: '0.85rem', fontWeight: '600', color: '#0f172a', marginBottom: '12px' }}>
          Arrival Forecast
        </div>
        <div style={{ height: '180px' }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
              <defs>
                <linearGradient id="arrivalGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis 
                dataKey="name" 
                tick={{ fontSize: 10, fill: '#94a3b8' }}
                tickLine={false}
                axisLine={{ stroke: '#e2e8f0' }}
                interval={Math.floor(timeRange / 8)}
              />
              <YAxis 
                tick={{ fontSize: 10, fill: '#94a3b8' }}
                tickLine={false}
                axisLine={{ stroke: '#e2e8f0' }}
              />
              <Tooltip content={<CustomTooltip />} />
              <Area
                type="monotone"
                dataKey="arrivals"
                stroke="#3b82f6"
                strokeWidth={2}
                fill="url(#arrivalGradient)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Stats Cards */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '20px' }}>
        <StatCard
          icon="📈"
          label="Peak Hour"
          value={forecast.summary.peakHour?.label || '--'}
          subtext={`+${forecast.summary.peakHour?.predicted || 0} arrivals`}
          color="#3b82f6"
        />
        <StatCard
          icon="📦"
          label="Capacity"
          value={capacityWarning ? `${capacityWarning.hoursFromNow}h` : 'OK'}
          subtext={capacityWarning ? `Hits ${capacityWarning.utilization}%` : 'Within limits'}
          color={capacityWarning ? '#f59e0b' : '#10b981'}
        />
        <StatCard
          icon="🚛"
          label="Departures"
          value={forecast.departuresDue}
          subtext="Due today"
          color="#8b5cf6"
        />
      </div>

      {/* Peak Windows */}
      {forecast.peakWindows.length > 0 && (
        <div style={{
          padding: '14px 16px',
          background: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)',
          borderRadius: '10px',
          border: '1px solid #f59e0b'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <span style={{ fontSize: '1rem' }}>⚡</span>
            <span style={{ fontWeight: '600', color: '#92400e', fontSize: '0.85rem' }}>
              Peak Operation Windows
            </span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {forecast.peakWindows.map((window, i) => (
              <span key={i} style={{
                padding: '6px 12px',
                background: '#ffffff',
                borderRadius: '6px',
                fontSize: '0.8rem',
                fontWeight: '500',
                color: '#92400e',
                border: '1px solid #fcd34d'
              }}>
                {window.start} - {window.end} ({window.avgArrivals} avg/hr)
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Capacity Projection Preview */}
      <div style={{ marginTop: '16px' }}>
        <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '8px' }}>
          Capacity Projection (next {timeRange}h)
        </div>
        <div style={{
          display: 'flex',
          height: '24px',
          borderRadius: '4px',
          overflow: 'hidden',
          background: '#f1f5f9'
        }}>
          {forecast.capacityProjection.slice(0, timeRange).map((c, i) => {
            const color = c.utilization >= 90 ? '#ef4444' 
                        : c.utilization >= 75 ? '#f59e0b' 
                        : '#10b981';
            return (
              <div
                key={i}
                style={{
                  flex: 1,
                  background: `linear-gradient(to top, ${color} ${c.utilization}%, transparent ${c.utilization}%)`,
                  borderRight: i < timeRange - 1 ? '1px solid #e2e8f0' : 'none'
                }}
                title={`${c.label}: ${c.utilization}% utilization`}
              />
            );
          })}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px', fontSize: '0.65rem', color: '#94a3b8' }}>
          <span>Now</span>
          <span>+{timeRange}h</span>
        </div>
      </div>

      {/* Summary Footer */}
      <div style={{
        marginTop: '16px',
        paddingTop: '16px',
        borderTop: '1px solid #e2e8f0',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        fontSize: '0.75rem',
        color: '#64748b'
      }}>
        <span>
          Total predicted arrivals: <strong style={{ color: '#0f172a' }}>{forecast.summary.totalPredictedArrivals}</strong>
        </span>
        <span>
          Last updated: {new Date().toLocaleTimeString()}
        </span>
      </div>
    </div>
  );
};

export default PredictiveAnalytics;
