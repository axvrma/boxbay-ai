import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ArrowDownToLine, ArrowUpRight, FlaskConical, Play, Timer } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { cancelJob, downloadJson, getEvidence, useJob, useJobState } from '../client'
import { resizeFacility } from '../components/Controls'
import { Empty, EvidenceError, Panel } from '../components/UI'
import { fmt, labels } from '../model'
import type { Benchmark, Catalog, Policy, Run, ScenarioId } from '../model'

export const measures = [
  ['moves', 'Completed moves', 'moves'], ['on_time_pct', 'On-time pickups', '%'],
  ['pickup_wait_s', 'Mean pickup wait', 's'], ['p95_wait_s', 'P95 pickup wait', 's'],
  ['kwh', 'Electrical energy', 'kWh'], ['kg_co2e', 'Operational emissions', 'kg CO₂e'],
  ['backlog', 'Ending backlog', 'tasks'], ['peak_backlog', 'Peak backlog', 'tasks'],
] as const

export default function Benchmarks() {
  const [scenario, setScenario] = useState<ScenarioId>('surge')
  const [baseline, setBaseline] = useState<Policy>('reactive')
  const [policy, setPolicy] = useState<Policy>('predictive')
  const [metric, setMetric] = useState('pickup_wait_s')
  const [seeds, setSeeds] = useState('102, 137, 208')
  const [racks, setRacks] = useState(3)
  const [cranes, setCranes] = useState(3)
  const [live, setLive] = useState<Benchmark>()
  const [error, setError] = useState('')
  const status = useJobState()
  const archived = useQuery({ queryKey: ['benchmarks'], queryFn: () => getEvidence<Benchmark>('benchmarks') })
  const catalog = useQuery({ queryKey: ['catalog'], queryFn: () => getEvidence<Catalog>('catalog') })
  const job = useJob<Benchmark>(setLive)
  const artifact = live ?? archived.data
  const rows = artifact?.rows.filter((r) => r.scenario === scenario && (r.policy === baseline || r.policy === policy)) ?? []
  const summaries = artifact?.summaries.filter((s) => s.scenario === scenario && s.baseline === baseline && s.policy === policy) ?? []
  const selected = measures.find((m) => m[0] === metric) ?? measures[0]
  const featured = summaries.find((s) => s.metric === metric)
  const bySeed = Array.from(new Set(rows.map((r) => r.seed))).map((seed) => ({
    seed,
    baseline: rows.find((r) => r.seed === seed && r.policy === baseline)?.[selected[0]],
    candidate: rows.find((r) => r.seed === seed && r.policy === policy)?.[selected[0]],
  }))
  const distribution = featured?.deltas.map((delta, i) => ({ seed: bySeed[i]?.seed ?? i + 1, delta })) ?? []
  const entry = catalog.data?.scenarios.find((s) => s.id === scenario)
  const numericSeeds = seeds.split(',').map((s) => Number(s.trim()))
  const valid = seeds.trim() && numericSeeds.length <= 6 && !seeds.split(',').some((s) => !s.trim()) &&
    numericSeeds.every((n) => Number.isInteger(n) && n >= 0 && n <= 2 ** 32 - 1) &&
    new Set(numericSeeds).size === numericSeeds.length && baseline !== policy &&
    racks >= 1 && racks <= 8 && cranes >= 0 && cranes <= racks

  async function start() {
    if (!valid) return
    setError('')
    try {
      let facility
      if (racks !== 3 || cranes !== 3) {
        const demo = await getEvidence<Run>('replays/surge-predictive')
        facility = resizeFacility(demo.scenario.facility, racks, cranes)
      }
      job.mutate({ path: '/benchmarks', result: '/benchmarks',
        payload: {scenario, seeds: numericSeeds, baseline, policy, facility} })
    } catch (e) { setError(String(e)) }
  }

  return <>
    <div className="page-intro"><div><div className="eyebrow"><FlaskConical size={15}/> EXPERIMENT LABORATORY</div>
      <h1>Benchmark laboratory</h1><p>Run matched comparisons across policies, workloads and equipment configurations.</p></div>
      <div className="intro-actions"><span className="badge">{live ? 'Live engine result' : 'Recorded experiments'}</span>
        {artifact && <button className="button" onClick={() => downloadJson(artifact.id, artifact)}><ArrowDownToLine size={16}/> Download report</button>}</div>
    </div>
    <Panel title="Experiment configuration" subtitle="Each policy receives the same starting inventory, workload, outages and simulation window.">
      <div className="lab-form"><label>Scenario<select value={scenario} disabled={!!status.status} onChange={(e) => {
        setScenario(e.target.value as ScenarioId); setLive(undefined)
      }}>{catalog.data?.scenarios.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <label>Baseline<select value={baseline} disabled={!!status.status} onChange={(e) => { setBaseline(e.target.value as Policy); setLive(undefined) }}>
        {Object.entries(labels).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      <label>Comparison policy<select value={policy} disabled={!!status.status} onChange={(e) => { setPolicy(e.target.value as Policy); setLive(undefined) }}>
        {Object.entries(labels).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      <label>Random seeds<input value={seeds} onChange={(e) => setSeeds(e.target.value)} placeholder="102, 137, 208"/></label>
      <label>Racks<input type="number" min="1" max="8" value={racks} onChange={(e) => { const value = Number(e.target.value); setRacks(value); setCranes(Math.min(cranes, value)) }}/></label>
      <label>Online cranes<input type="number" min="0" max={racks} value={cranes} onChange={(e) => setCranes(Number(e.target.value))}/></label>
      <button className="button primary" disabled={!valid || !!status.status} onClick={() => void start()}><Play size={15}/>{status.status || 'Run experiment'}</button>
      {status.id && <button className="button" onClick={() => { void cancelJob(status.id).catch((e) => setError(String(e))) }}>Cancel</button>}
      {live && <button className="button" onClick={() => setLive(undefined)}>Recorded results</button>}
      </div>
    </Panel>
    {archived.error && <EvidenceError error={archived.error}/>}
    {job.error && <EvidenceError error={job.error}/>}
    {error && <EvidenceError error={error}/>}
    {summaries.length ? <>
      <div className="comparison-cards">{measures.slice(0, 6).map(([key, title, unit]) => {
        const data = summaries.find((s) => s.metric === key)
        if (!data) return null
        const positive = (key === 'moves' || key === 'on_time_pct') ? data.delta > 0 : data.delta < 0
        return <button className={`comparison-card ${key === metric ? 'active' : ''}`} key={key} onClick={() => setMetric(key)}>
          <span>{title}</span><strong>{fmt(data.policy_mean, key === 'moves' ? 0 : 1)} <small>{unit}</small></strong>
          <span className={data.delta === 0 ? '' : positive ? 'good' : 'adverse'}>{data.delta > 0 ? '+' : ''}{fmt(data.delta, 1)} vs baseline</span>
        </button>
      })}</div>
      <div className="evidence-grid">
        <Panel title="Paired outcomes by seed" subtitle={`${selected[1]} · ${selected[2]} · simulated`}
          action={<select aria-label="Metric" value={metric} onChange={(e) => setMetric(e.target.value)}>
            {measures.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>}>
          <div className="chart"><ResponsiveContainer><BarChart data={bySeed} barGap={4} margin={{ top: 12, right: 14, bottom: 5 }}>
            <CartesianGrid vertical={false} stroke="#e3e9eb"/><XAxis dataKey="seed"/><YAxis width={50}/><Tooltip/><Legend/>
            <Bar dataKey="baseline" name={labels[baseline]} fill="#8192aa" radius={[4, 4, 0, 0]} isAnimationActive={false}/>
            <Bar dataKey="candidate" name={labels[policy]} fill="#128a7b" radius={[4, 4, 0, 0]} isAnimationActive={false}/>
          </BarChart></ResponsiveContainer></div>
        </Panel>
        <Panel title="Statistical evidence" subtitle="Paired deltas are comparison policy minus baseline">
          {featured && <div className="stat-list">
            <dl><dt>Seed pairs</dt><dd>{featured.pairs}</dd><dt>Mean paired delta</dt><dd>{fmt(featured.delta, 2)} {selected[2]}</dd>
              <dt>Median · P95</dt><dd>{fmt(featured.median_delta, 2)} · {fmt(featured.p95_delta, 2)}</dd>
              <dt>95% bootstrap interval</dt><dd>{featured.ci_low == null || featured.ci_high == null ? 'Requires ≥3 pairs'
                : `${fmt(featured.ci_low, 2)} to ${fmt(featured.ci_high, 2)}`}</dd>
              <dt>Adverse seed pairs</dt><dd>{featured.negative_pairs} of {featured.pairs}</dd>
              <dt>Audited constraint violations</dt><dd>{artifact?.constraint_violations ?? '—'}</dd>
              <dt>Solver calls below optimal proof</dt><dd>{rows.reduce((n, r) => n + r.solver_limited, 0)} of {rows.reduce((n, r) => n + r.solver_calls, 0)}</dd>
            </dl>
            <p className="muted">Small samples quantify variability in these fixtures. Completion, SLA and ending backlog should be read together.</p>
            {entry?.recorded && <Link className="button" to={`/?scenario=${scenario}&policy=${policy}`}><ArrowUpRight size={15}/> Open recorded replay</Link>}
          </div>}
        </Panel>
      </div>
      <Panel title="Paired delta distribution" subtitle={`${selected[1]} · ${selected[2]}`}>
        <div className="chart medium"><ResponsiveContainer><BarChart data={distribution} margin={{right: 15, top: 8}}>
          <CartesianGrid vertical={false} stroke="#e3e9eb"/><XAxis dataKey="seed"/><YAxis width={49}/><Tooltip/>
          <Bar dataKey="delta" name="Comparison minus baseline" fill="#577c99" radius={3} isAnimationActive={false}/>
        </BarChart></ResponsiveContainer></div>
      </Panel>
      <Panel title="Run evidence" subtitle={`${artifact?.model_version} · ${artifact?.dataset_version}`}>
        <div className="data-table"><table><thead><tr><th>Seed</th><th>Policy</th><th>Moves</th><th>Late pickups</th><th>Backlog</th><th>kWh</th><th>CO₂e kg</th><th><Timer size={13}/> Runtime</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={`${r.seed}-${r.policy}`}><td>{r.seed}</td><td>{labels[r.policy]}</td><td>{r.moves}</td>
            <td>{r.late}</td><td>{r.backlog}</td><td>{fmt(r.kwh, 1)}</td><td>{fmt(r.kg_co2e, 2)}</td><td>{fmt(r.elapsed_ms)} ms</td></tr>)}</tbody></table></div>
      </Panel>
    </> : <Panel title="Experiment results"><Empty>{archived.isLoading ? 'Loading paired results…' : 'Choose different policies or run this comparison.'}</Empty></Panel>}
  </>
}
