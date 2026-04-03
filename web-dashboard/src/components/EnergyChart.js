import React from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from 'recharts';

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div style={{
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: '8px',
        padding: '12px 16px',
        boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)'
      }}>
        <p style={{ color: '#64748b', fontSize: '0.8rem', marginBottom: '8px', fontWeight: '500' }}>{label}</p>
        {payload.map((entry, index) => (
          <p key={index} style={{ color: entry.color, fontSize: '0.85rem', margin: '4px 0', fontWeight: '600' }}>
            {entry.name}: {entry.value.toFixed(3)} kWh
          </p>
        ))}
        {payload.length === 2 && (
          <p style={{ 
            color: '#10b981', 
            fontSize: '0.85rem', 
            marginTop: '8px', 
            paddingTop: '8px', 
            borderTop: '1px solid #e2e8f0',
            fontWeight: '600'
          }}>
            Saved: {(payload[1].value - payload[0].value).toFixed(3)} kWh
          </p>
        )}
      </div>
    );
  }
  return null;
};

const EnergyChart = ({ hourlyData, savedKwh, savedPct }) => {
  const filteredData = hourlyData?.filter(d => d.smart > 0 || d.random > 0) || [];
  
  const totalSmart = hourlyData?.reduce((sum, d) => sum + d.smart, 0) || 0;
  const totalRandom = hourlyData?.reduce((sum, d) => sum + d.random, 0) || 0;

  return (
    <div style={{
      background: '#ffffff',
      borderRadius: '16px',
      padding: '24px',
      border: '1px solid #e2e8f0',
      boxShadow: '0 1px 3px 0 rgb(0 0 0 / 0.1)'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h3 style={{ margin: 0, color: '#0f172a', fontSize: '1.1rem', fontWeight: '600' }}>
          Energy Analytics
        </h3>
        <div style={{ display: 'flex', gap: '16px', fontSize: '0.75rem' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#64748b' }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#3b82f6' }}></span>
            Smart
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#64748b' }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#f87171' }}></span>
            Random
          </span>
        </div>
      </div>

      {filteredData.length > 0 ? (
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={filteredData}>
            <defs>
              <linearGradient id="colorSmart" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.2}/>
                <stop offset="95%" stopColor="#3B82F6" stopOpacity={0}/>
              </linearGradient>
              <linearGradient id="colorRandom" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#F87171" stopOpacity={0.2}/>
                <stop offset="95%" stopColor="#F87171" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis 
              dataKey="hour" 
              stroke="#94a3b8" 
              tick={{ fontSize: 10, fill: '#94a3b8' }}
              tickFormatter={(val) => val.split(':')[0]}
              axisLine={{ stroke: '#e2e8f0' }}
            />
            <YAxis 
              stroke="#94a3b8" 
              tick={{ fontSize: 10, fill: '#94a3b8' }}
              axisLine={{ stroke: '#e2e8f0' }}
            />
            <Tooltip content={<CustomTooltip />} />
            <Area
              type="monotone"
              dataKey="smart"
              name="Smart Placement"
              stroke="#3B82F6"
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#colorSmart)"
            />
            <Area
              type="monotone"
              dataKey="random"
              name="Random Placement"
              stroke="#F87171"
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#colorRandom)"
            />
          </AreaChart>
        </ResponsiveContainer>
      ) : (
        <div style={{ 
          height: '200px', 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center', 
          color: '#94a3b8',
          background: '#f8fafc',
          borderRadius: '8px',
          border: '1px dashed #e2e8f0'
        }}>
          No energy data yet. Add containers to see analytics.
        </div>
      )}

      <div style={{ 
        marginTop: '20px', 
        paddingTop: '20px', 
        borderTop: '1px solid #e2e8f0',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <div>
          <span style={{ color: '#64748b', fontSize: '0.85rem', fontWeight: '500' }}>Total Saved Today</span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginTop: '4px' }}>
            <span style={{ fontSize: '1.5rem', fontWeight: '700', color: '#10b981' }}>
              {savedKwh?.toFixed(2) || 0} kWh
            </span>
            <span style={{ color: '#10b981', fontSize: '0.9rem', fontWeight: '500' }}>
              ({savedPct || 0}% reduction)
            </span>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Smart: {totalSmart.toFixed(2)} kWh</div>
          <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Random: {totalRandom.toFixed(2)} kWh</div>
        </div>
      </div>
    </div>
  );
};

export default EnergyChart;
