import React, { useState, useCallback } from 'react';
import {
  SCENARIO_PRESETS,
  runSimulation,
  compareScenarios,
  generateRecommendation
} from '../ai/simulationEngine';

const ParameterSlider = ({ label, value, onChange, min = 0, max = 200, unit = '%' }) => (
  <div style={{ marginBottom: '16px' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
      <span style={{ fontSize: '0.8rem', color: '#64748b' }}>{label}</span>
      <span style={{ fontSize: '0.85rem', fontWeight: '600', color: '#0f172a' }}>
        {value}{unit}
      </span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      value={value}
      onChange={(e) => onChange(parseInt(e.target.value))}
      style={{
        width: '100%',
        height: '6px',
        borderRadius: '3px',
        background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${(value - min) / (max - min) * 100}%, #e2e8f0 ${(value - min) / (max - min) * 100}%, #e2e8f0 100%)`,
        appearance: 'none',
        cursor: 'pointer'
      }}
    />
  </div>
);

const ResultCard = ({ label, baseline, scenario, unit = '', isPercentage = false, invertColors = false }) => {
  const change = scenario - baseline;
  const changePercent = baseline !== 0 ? ((change / baseline) * 100) : 0;
  const isPositive = invertColors ? change < 0 : change > 0;
  const isNegative = invertColors ? change > 0 : change < 0;

  return (
    <div style={{
      padding: '16px',
      background: '#f8fafc',
      borderRadius: '10px',
      border: '1px solid #e2e8f0'
    }}>
      <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '8px' }}>{label}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <div style={{ fontSize: '0.65rem', color: '#94a3b8' }}>Current</div>
          <div style={{ fontSize: '1.1rem', fontWeight: '600', color: '#64748b' }}>
            {baseline}{unit}
          </div>
        </div>
        <div style={{ textAlign: 'center', padding: '0 12px' }}>
          <span style={{ fontSize: '1.25rem', color: '#94a3b8' }}>→</span>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '0.65rem', color: '#94a3b8' }}>Scenario</div>
          <div style={{ fontSize: '1.1rem', fontWeight: '700', color: '#0f172a' }}>
            {scenario}{unit}
          </div>
        </div>
      </div>
      {change !== 0 && (
        <div style={{
          marginTop: '8px',
          padding: '4px 8px',
          borderRadius: '4px',
          fontSize: '0.7rem',
          fontWeight: '600',
          textAlign: 'center',
          background: isNegative ? '#fef2f2' : isPositive ? '#f0fdf4' : '#f8fafc',
          color: isNegative ? '#dc2626' : isPositive ? '#16a34a' : '#64748b'
        }}>
          {change > 0 ? '+' : ''}{isPercentage ? `${changePercent.toFixed(0)}%` : `${change.toFixed(1)}${unit}`}
        </div>
      )}
    </div>
  );
};

const RecommendationCard = ({ recommendation }) => {
  const typeConfig = {
    CRITICAL: { bg: '#fef2f2', border: '#fecaca', icon: '🚨', color: '#dc2626' },
    WARNING: { bg: '#fefce8', border: '#fef08a', icon: '⚠️', color: '#ca8a04' },
    POSITIVE: { bg: '#f0fdf4', border: '#bbf7d0', icon: '✅', color: '#16a34a' }
  };

  const config = typeConfig[recommendation.type] || typeConfig.WARNING;

  return (
    <div style={{
      padding: '12px 16px',
      background: config.bg,
      border: `1px solid ${config.border}`,
      borderRadius: '8px',
      marginBottom: '8px'
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
        <span style={{ fontSize: '1rem' }}>{config.icon}</span>
        <div>
          <div style={{ fontWeight: '600', color: config.color, fontSize: '0.85rem' }}>
            {recommendation.area}: {recommendation.message}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '4px' }}>
            {recommendation.suggestion}
          </div>
        </div>
      </div>
    </div>
  );
};

const WhatIfSimulator = ({ gridState = [], isOpen, onClose }) => {
  const [selectedPreset, setSelectedPreset] = useState('PEAK_SEASON');
  const [params, setParams] = useState({
    arrivalRate: 180,
    dwellTime: 80,
    craneSpeed: 100
  });
  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults] = useState(null);
  const [comparison, setComparison] = useState(null);
  const [recommendations, setRecommendations] = useState([]);

  // Handle preset selection
  const handlePresetChange = (presetKey) => {
    setSelectedPreset(presetKey);
    const preset = SCENARIO_PRESETS[presetKey];
    if (preset) {
      setParams({
        arrivalRate: Math.round(preset.params.arrivalRateMultiplier * 100),
        dwellTime: Math.round(preset.params.dwellTimeMultiplier * 100),
        craneSpeed: Math.round(preset.params.craneSpeedMultiplier * 100)
      });
    }
    setResults(null);
    setComparison(null);
    setRecommendations([]);
  };

  // Run simulation
  const handleRunSimulation = useCallback(async () => {
    setIsRunning(true);
    setResults(null);
    setComparison(null);
    setRecommendations([]);

    // Small delay for UI feedback
    await new Promise(resolve => setTimeout(resolve, 100));

    try {
      // Run baseline (current conditions)
      const baselineParams = {
        arrivalRateMultiplier: 1.0,
        dwellTimeMultiplier: 1.0,
        craneSpeedMultiplier: 1.0
      };
      const baselineResults = runSimulation(gridState, baselineParams, 30);

      // Run scenario
      const scenarioParams = {
        arrivalRateMultiplier: params.arrivalRate / 100,
        dwellTimeMultiplier: params.dwellTime / 100,
        craneSpeedMultiplier: params.craneSpeed / 100
      };
      const scenarioResults = runSimulation(gridState, scenarioParams, 30);

      // Compare results
      const comp = compareScenarios(baselineResults, scenarioResults);
      
      // Generate recommendations
      const preset = SCENARIO_PRESETS[selectedPreset];
      const recs = generateRecommendation(comp, preset?.name || 'Custom Scenario');

      setResults({ baseline: baselineResults, scenario: scenarioResults });
      setComparison(comp);
      setRecommendations(recs);
    } catch (error) {
      console.error('Simulation error:', error);
    }

    setIsRunning(false);
  }, [gridState, params, selectedPreset]);

  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0, 0, 0, 0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      padding: '20px'
    }}>
      <div style={{
        background: '#ffffff',
        borderRadius: '20px',
        width: '100%',
        maxWidth: '800px',
        maxHeight: '90vh',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 25px 50px -12px rgb(0 0 0 / 0.25)'
      }}>
        {/* Header */}
        <div style={{
          padding: '20px 24px',
          borderBottom: '1px solid #e2e8f0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div>
            <h2 style={{ margin: 0, color: '#0f172a', fontSize: '1.25rem', fontWeight: '700' }}>
              What-If Simulator
            </h2>
            <p style={{ margin: '4px 0 0 0', fontSize: '0.8rem', color: '#64748b' }}>
              Monte Carlo simulation with {results ? '30' : '50'} iterations
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '50%',
              border: 'none',
              background: '#f1f5f9',
              color: '#64748b',
              fontSize: '1.25rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: 'auto', padding: '24px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
            {/* Left: Configuration */}
            <div>
              {/* Scenario Presets */}
              <div style={{ marginBottom: '20px' }}>
                <label style={{ fontSize: '0.85rem', fontWeight: '600', color: '#0f172a', display: 'block', marginBottom: '10px' }}>
                  Scenario Preset
                </label>
                <select
                  value={selectedPreset}
                  onChange={(e) => handlePresetChange(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    borderRadius: '10px',
                    border: '1px solid #e2e8f0',
                    fontSize: '0.9rem',
                    color: '#0f172a',
                    background: '#f8fafc',
                    cursor: 'pointer'
                  }}
                >
                  {Object.entries(SCENARIO_PRESETS).map(([key, preset]) => (
                    <option key={key} value={key}>{preset.name}</option>
                  ))}
                </select>
                <p style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '6px' }}>
                  {SCENARIO_PRESETS[selectedPreset]?.description}
                </p>
              </div>

              {/* Parameters */}
              <div style={{
                padding: '20px',
                background: '#f8fafc',
                borderRadius: '12px',
                border: '1px solid #e2e8f0'
              }}>
                <div style={{ fontSize: '0.85rem', fontWeight: '600', color: '#0f172a', marginBottom: '16px' }}>
                  Parameters
                </div>
                <ParameterSlider
                  label="Arrival Rate"
                  value={params.arrivalRate}
                  onChange={(v) => setParams(p => ({ ...p, arrivalRate: v }))}
                  min={20}
                  max={250}
                />
                <ParameterSlider
                  label="Avg Dwell Time"
                  value={params.dwellTime}
                  onChange={(v) => setParams(p => ({ ...p, dwellTime: v }))}
                  min={30}
                  max={200}
                />
                <ParameterSlider
                  label="Crane Speed"
                  value={params.craneSpeed}
                  onChange={(v) => setParams(p => ({ ...p, craneSpeed: v }))}
                  min={30}
                  max={150}
                />
              </div>

              {/* Run Button */}
              <button
                onClick={handleRunSimulation}
                disabled={isRunning}
                style={{
                  width: '100%',
                  padding: '14px',
                  marginTop: '16px',
                  background: isRunning 
                    ? '#94a3b8'
                    : 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '10px',
                  fontSize: '0.95rem',
                  fontWeight: '600',
                  cursor: isRunning ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  boxShadow: isRunning ? 'none' : '0 4px 14px rgba(59, 130, 246, 0.3)'
                }}
              >
                {isRunning ? (
                  <>
                    <span style={{ 
                      width: '16px', 
                      height: '16px', 
                      border: '2px solid #ffffff40',
                      borderTopColor: '#ffffff',
                      borderRadius: '50%',
                      animation: 'spin 1s linear infinite'
                    }} />
                    Running Simulation...
                  </>
                ) : (
                  <>▶ Run Simulation</>
                )}
              </button>
            </div>

            {/* Right: Results */}
            <div>
              {!results ? (
                <div style={{
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '40px',
                  background: '#f8fafc',
                  borderRadius: '12px',
                  border: '1px dashed #e2e8f0'
                }}>
                  <span style={{ fontSize: '3rem', marginBottom: '16px' }}>🔬</span>
                  <div style={{ color: '#64748b', fontSize: '0.9rem', textAlign: 'center' }}>
                    Configure parameters and run simulation to see results
                  </div>
                </div>
              ) : (
                <div>
                  {/* Results Grid */}
                  <div style={{ 
                    display: 'grid', 
                    gridTemplateColumns: '1fr 1fr', 
                    gap: '12px',
                    marginBottom: '20px'
                  }}>
                    <ResultCard
                      label="Energy (kWh)"
                      baseline={results.baseline.energy.mean}
                      scenario={results.scenario.energy.mean}
                      unit=" kWh"
                      invertColors={true}
                    />
                    <ResultCard
                      label="Wait Time"
                      baseline={results.baseline.waitTime.mean}
                      scenario={results.scenario.waitTime.mean}
                      unit=" min"
                      invertColors={true}
                    />
                    <ResultCard
                      label="Avg Utilization"
                      baseline={results.baseline.utilization.mean}
                      scenario={results.scenario.utilization.mean}
                      unit="%"
                    />
                    <ResultCard
                      label="Peak Utilization"
                      baseline={results.baseline.utilization.peak}
                      scenario={results.scenario.utilization.peak}
                      unit="%"
                    />
                  </div>

                  {/* AI Recommendations */}
                  <div>
                    <div style={{ 
                      fontSize: '0.85rem', 
                      fontWeight: '600', 
                      color: '#0f172a', 
                      marginBottom: '12px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px'
                    }}>
                      <span>💡</span> AI Recommendations
                    </div>
                    {recommendations.map((rec, i) => (
                      <RecommendationCard key={i} recommendation={rec} />
                    ))}
                  </div>

                  {/* Confidence Note */}
                  <div style={{
                    marginTop: '16px',
                    padding: '12px',
                    background: '#f0f9ff',
                    borderRadius: '8px',
                    border: '1px solid #bae6fd',
                    fontSize: '0.75rem',
                    color: '#0369a1'
                  }}>
                    Results based on 30 Monte Carlo iterations. Energy std: ±{results.scenario.energy.std} kWh
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

export default WhatIfSimulator;
