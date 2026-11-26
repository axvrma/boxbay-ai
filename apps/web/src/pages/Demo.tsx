import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Box, CalendarDays, ChevronDown, CircleHelp, Clock3, Factory, Gauge,
  Maximize, Minimize, RotateCcw, Settings2, Sparkles, Zap } from 'lucide-react'
import { useStore } from 'zustand'
import { dubaiDate, formatDubai } from '../intelligence/inference'
import type { Bundle, Prediction } from '../intelligence/inference'
import { changeConditions, completeRelocation, evaluate, initialize, makePickup, apply,
  elapsedIdle, opportunities, partialPlacement, projectedRetrieval } from '../simulation/engine'
import type { Opportunity, Plan, Ranking, State } from '../simulation/engine'
import { cost, movement } from '../simulation/physics'
import { createSession } from '../simulation/session'
import type { DemoData, Operating, Rates } from '../simulation/types'
import type { Animation, Camera } from '../three/FacilityView'
import type { Request, Response } from '../workers/optimization'

const View = lazy(() => import('../three/FacilityView'))
const steps = { arrived: 1, predicted: 2, placed: 3, review: 4 }
const actions = { arrived: 'Predict', predicted: 'Place container', placed: 'Review optimization', review: 'Next container' }
const titles = { arrived: 'Container arrives', predicted: 'AI prediction', placed: 'Container placed', review: 'Optimization review' }
const signed = (value: number, decimals: number) => `${value > .0001 ? '+' : value < -.0001 ? '−' : ''}${Math.abs(value).toFixed(decimals)}`
const choiceLabel = (choice: Ranking) => `Rack ${choice.slot.rack} · Bay ${String(choice.slot.bay).padStart(2,'0')} · Level ${choice.slot.level}`

function PredictionCard({ prediction, previous }: { prediction: Prediction; previous: Prediction | undefined }) {
  return <>
    <div className="prediction-number">{prediction.days.toFixed(1)} <small>days</small></div>
    <p className="pickup-label">Expected pickup · {formatDubai(prediction.pickup)}</p>
    <div className="prediction-meta"><span className="chip blue">{prediction.category} mover</span><span>{prediction.event}</span></div>
    {previous && previous.days !== prediction.days && <p className="impact-change">Prior conditions {previous.days.toFixed(2)} d · {signed(prediction.days - previous.days, 2)} d</p>}
  </>
}

function Factors({ prediction }: { prediction: Prediction }) {
  const factors = prediction.sensitivity.filter(({ days }) => Math.abs(days) >= .005)
  return <section className="side-section">
    <h2>Why this prediction?</h2>
    {!factors.length && <p className="muted">These reference inputs produced no material changes.</p>}
    {factors.slice(0,3).map(({ feature, days }) => <div className="factor" key={feature}>
      <span>{feature}</span><strong className={days < 0 ? 'green-text' : 'amber-text'}>{signed(days,2)} d</strong>
    </div>)}
    <details><summary>Model details</summary>
      <p>Each value compares the current inference with one input replaced by its training-median reference. Effects can overlap.</p>
      {prediction.low !== null && prediction.high !== null && <p>Synthetic 90% target interval · {prediction.low.toFixed(1)}–{prediction.high.toFixed(1)} d</p>}
      {factors.slice(3).map(({ feature, days }) => <div className="factor" key={feature}><span>{feature}</span><strong>{signed(days,2)} d</strong></div>)}
      <p>{prediction.version} · {prediction.durationMs.toFixed(1)} ms including sensitivity</p>
    </details>
  </section>
}

function Impact({ state, data }: { state: State; data: DemoData }) {
  const actual = state.floor.metrics
  const baseline = state.baseline.metrics
  const aed = cost(actual, state.rates)
  const estimate = projectedRetrieval(data, state.floor, state.operation)
  const baselineEstimate = projectedRetrieval(data, state.baseline, state.operation)
  const retrievalDiff = estimate !== null && baselineEstimate !== null ? estimate - baselineEstimate : null
  const energyDiff = actual.kwh - baseline.kwh
  const aedDiff = aed - cost(baseline, state.rates)
  return <section className="impact-strip" aria-label="Business impact">
    <div><Zap size={15}/><span>Energy used</span><strong>{actual.kwh.toFixed(2)} <small>kWh</small></strong>
      <small>{signed(energyDiff,2)} kWh vs first available{actual.placements !== baseline.placements && ' · different placements'}</small></div>
    <div><Clock3 size={15}/><span>Est. retrieval</span><strong>{estimate === null ? '—' : estimate.toFixed(0)} <small>s</small></strong>
      <small>{retrievalDiff === null ? 'Mean for accessible inventory' : `${signed(retrievalDiff,1)} s vs first available · accessible inventory`}</small></div>
    <div><Gauge size={15}/><span>Operating cost</span><strong>{aed.toFixed(2)} <small>AED</small></strong>
      <small>{signed(aedDiff,2)} AED vs first available · USD {(aed * state.rates.usd).toFixed(2)}</small></div>
    <div><Box size={15}/><span>Storage occupancy</span><strong>{state.floor.inventory.length}<small> / {data.cells.length} cells</small></strong>
      <small>{actual.moves} moves · {(actual.kwh * state.rates.emissions).toFixed(2)} kg CO₂e est.</small></div>
  </section>
}

export default function Demo({ data, bundle }: { data: DemoData; bundle: Bundle }) {
  const session = useMemo(() => createSession(initialize(data, bundle)), [data, bundle])
  const { state, history, commit, previous, reset } = useStore(session)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [animation, setAnimation] = useState<Animation>()
  const [camera, setCamera] = useState<Camera>('isometric')
  const [cameraVersion, setCameraVersion] = useState(0)
  const [map, setMap] = useState(false)
  const [selected, setSelected] = useState<string>()
  const [settings, setSettings] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const worker = useRef<Worker | null>(null)
  const locked = useRef(false)
  const mounted = useRef(true)
  const movementTimer = useRef<number>(undefined)
  const choice = state.decision?.choices.find((item) => item.slot.id === state.override) ?? state.decision?.choices[0]
  const current = data.incoming[state.cargoIndex]
  const picked = data.cells.find((cell) => cell.id === selected)
  const selectedCargo = state.floor.inventory.find((item) => item.slot === selected)
  const due = state.floor.inventory.filter((item) => item.ready <= state.clock)
    .find((item) => makePickup(data, state.floor, item, state.operation))
  const definition = state.step === 'review' ? state.advice?.[0] : undefined
  const target = animation?.plan.target ?? (state.step === 'predicted' ? choice?.slot : definition?.plan.target)
  const withPrediction = state.step === 'predicted' || state.step === 'placed'
  const label = actions[state.step]

  useEffect(() => {
    mounted.current = true
    const isFullscreen = () => setFullscreen(document.fullscreenElement?.id === 'root')
    document.addEventListener('fullscreenchange', isFullscreen)
    let optimizer: Worker | undefined
    try {
      optimizer = new Worker(new URL('../workers/optimization.ts', import.meta.url), { type: 'module' })
      optimizer.postMessage({ type: 'init', data, bundle } satisfies Request)
      worker.current = optimizer
    } catch {
      optimizer?.terminate()
      worker.current = null
    }
    return () => {
      mounted.current = false
      window.clearTimeout(movementTimer.current)
      optimizer?.terminate()
      worker.current = null
      document.removeEventListener('fullscreenchange', isFullscreen)
    }
  }, [data, bundle])

  function review(snapshot: State): Promise<Opportunity[]> {
    const engine = worker.current
    if (!engine) return Promise.resolve(opportunities(snapshot, data, bundle))
    return new Promise((resolve, reject) => {
      engine.onmessage = ({ data: result }: MessageEvent<Response>) => {
        window.clearTimeout(timeout)
        if ('error' in result) reject(Error(result.error))
        else resolve(result.opportunities)
      }
      engine.onerror = () => {
        window.clearTimeout(timeout)
        engine.terminate()
        worker.current = null
        reject(Error('The optimization worker could not complete the review.'))
      }
      const timeout = window.setTimeout(() => {
        engine.terminate()
        worker.current = null
        reject(Error('Optimization timed out. Try again.'))
      }, 6000)
      engine.postMessage({ type: 'review', state: snapshot } satisfies Request)
    })
  }

  async function attempt(run: () => Promise<void>) {
    if (locked.current) return
    locked.current = true
    setBusy(true)
    setMessage('')
    try {
      await run()
    } catch (error: unknown) {
      if (mounted.current) setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      locked.current = false
      if (mounted.current) setBusy(false)
    }
  }

  async function animate(plan: Plan) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const duration = Math.max(1300, Math.min(3200, movement(plan.legs).seconds * 38))
    setAnimation({ plan, duration, start: performance.now() })
    await new Promise<void>((resolve) => { movementTimer.current = window.setTimeout(resolve, duration) })
    if (mounted.current) setAnimation(undefined)
  }

  async function optimize(snapshot: State, execute: boolean) {
    const advice = await review(snapshot)
    if (!mounted.current) return
    const candidate = advice[0]
    const reviewed = { ...snapshot, advice, notice: candidate ? '' :
      'No relocation recommended. The current arrangement is already preferable under the selected conditions.' }
    if (!candidate || !execute) {
      commit(reviewed)
      return
    }
    const after = completeRelocation(reviewed, candidate)
    await animate(candidate.plan)
    if (mounted.current) commit(after)
  }

  function next() {
    void attempt(async () => {
      if (state.step === 'arrived') {
        const decision = evaluate(state, data, bundle)
        if (decision) commit({ ...state, step: 'predicted', decision })
      } else if (state.step === 'predicted' && choice) {
        const action = partialPlacement(state, data, choice)
        await animate(action.plan)
        if (!mounted.current) return
        commit(action.next)
        if (state.auto) await optimize(action.next, true)
      } else if (state.step === 'placed') {
        await optimize({ ...state, step: 'review' }, false)
      } else if (state.step === 'review' && state.cargoIndex + 1 < data.incoming.length) {
        commit({ ...state, step: 'arrived', cargoIndex: state.cargoIndex + 1, decision: null, comparison: undefined, override: undefined, lastRelocation: undefined, advice: null, notice: '' })
      }
    })
  }

  function context(operation: Operating, date: string) {
    if (!date || date < data.dateMin || date > data.dateMax) return
    void attempt(async () => {
      const changed = changeConditions(state, operation, date)
      if (changed === state) {
        setMessage('Start a new session to move the clock before a completed operation.')
        return
      }
      if (state.step === 'predicted') {
        commit({ ...changed, step: 'predicted', comparison: state.decision?.prediction, decision: evaluate(changed, data, bundle) })
      } else {
        commit(changed)
        const vesselChange = Math.abs(changed.operation.vessel - state.operation.vessel)
        const relevant = changed.operation.cranes !== state.operation.cranes || vesselChange >= .05 ||
          Math.abs(changed.operation.congestion - state.operation.congestion) >= .05 ||
          Math.abs(changed.operation.truck - state.operation.truck) >= .05 ||
          Math.abs(changed.operation.occupancy - state.operation.occupancy) >= .05 || date !== dubaiDate(state.clock)
        if (relevant && (changed.auto || changed.step === 'review')) await optimize(changed, changed.auto)
      }
    })
  }

  function collect() {
    if (!due) return
    void attempt(async () => {
      const plan = makePickup(data, state.floor, due, state.operation)
      if (!plan) return
      const other = state.baseline.inventory.find((item) => item.cargo.id === due.cargo.id)
      const basePlan = other && makePickup(data, state.baseline, other, state.operation)
      const duration = movement(plan.legs, state.operation.cranes).seconds
      const baseDuration = basePlan ? movement(basePlan.legs, state.operation.cranes).seconds : 0
      const wall = Math.max(duration, baseDuration)
      const floor = apply(state.floor, plan, state.operation, state.clock, due.days, 0)
      const baseline = basePlan ? apply(state.baseline, basePlan, state.operation, state.clock, due.days, 0) : state.baseline
      const after = { ...state, clock: state.clock + Math.round(wall * 1000),
        floor: elapsedIdle(floor, wall-duration, state.operation.cranes),
        baseline: elapsedIdle(baseline, wall-baseDuration, state.operation.cranes),
        step: state.step === 'predicted' ? 'arrived' as const : state.step, decision: null,
        advice: null, notice: `${plan.cargo.id} delivered to outbound transfer.` }
      await animate(plan)
      if (mounted.current) commit(after)
    })
  }

  const changeRates = (key: keyof Rates, value: number) => commit({ ...state, rates: { ...state.rates, [key]: value }, advice: null })
  return <div className="demo-shell">
    <section className="twin-panel" aria-label="Facility viewer">
      <div className="viewport"><Suspense fallback={<div className="view-status">Preparing 3D facility…</div>}>
        <View data={data} state={state} target={target} selected={selected} onSelect={setSelected}
            camera={camera} cameraVersion={cameraVersion} animation={animation} map={map}/>
      </Suspense></div>
    </section>

    <div className="demo-hud">
      <div className="view-controls">
        <div className="context-bar hud-card">
          <label><CalendarDays size={17}/><span><small>Simulation date · GST</small>
            <input aria-label="Simulation date" type="date" min={data.dateMin} max={data.dateMax} value={dubaiDate(state.clock)}
              disabled={busy} onChange={(e) => context(state.operation, e.currentTarget.value)}/></span></label>
          <label><Factory size={17}/><span><small>Operating scenario</small>
            <select aria-label="Operating scenario" value={state.operation.id} disabled={busy} onChange={(e) => {
              const selected = data.scenarios.find((entry) => entry.id === e.currentTarget.value)
              if (selected) context(selected, dubaiDate(state.clock))
            }}>{data.scenarios.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></span></label>
          <div className="crane-status"><span className={state.operation.cranes === 2 ? 'status-light' : 'status-light amber'}/><span>
            <small>Crane availability</small><strong>{state.operation.cranes} of 2 online</strong></span></div>
          <div className="context-end"><button type="button" className="button subdued" onClick={() => setSettings(!settings)}
            aria-expanded={settings} disabled={busy}><Settings2 size={15}/> <span>Conditions</span></button></div>
        </div>
        <div className="twin-toolbar hud-card">
          <div className="twin-title"><span className="status-light"/><strong>High-bay facility</strong><span className="twin-detail">Two racks · {data.cells.length} cells</span></div>
          <div className="camera-actions">
            <select aria-label="Camera view" value={camera} disabled={map} onChange={(e) => setCamera(e.currentTarget.value as Camera)}>
              <option value="isometric">Isometric</option><option value="front">Front</option><option value="top">Top</option>
            </select>
            <button className="icon-button" aria-label="Reset camera" title="Reset camera" disabled={map}
              onClick={() => { setCamera('isometric'); setCameraVersion(cameraVersion+1) }}><RotateCcw size={15}/></button>
            <button className="button subdued map-button" aria-pressed={map} onClick={() => setMap(!map)}>{map ? '3D view' : '2D map'}</button>
            <button className="icon-button" aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}
              title={fullscreen ? 'Exit full screen' : 'Full screen'} onClick={() => {
                const request = fullscreen ? document.exitFullscreen?.() : document.getElementById('root')?.requestFullscreen?.()
                const unavailable = () => setMessage('Full-screen presentation is unavailable in this browser.')
                if (request) void request.catch(unavailable)
                else unavailable()
              }}>{fullscreen ? <Minimize size={16}/> : <Maximize size={16}/>}</button>
          </div>
        </div>        <div className="scene-footer hud-card">
          <div className="legend"><span className="fast">Fast dwell</span><span className="medium">Medium</span>
            <span className="long">Long</span><span className="recommended">Recommended</span><span className="priority">Priority</span>
            <span className="restricted">Restricted</span></div>
          <span className="inspection" data-selected={Boolean(picked)}>{picked ? `${picked.id} · ${selectedCargo?.cargo.id ?? (picked.blocked ? 'Restricted' : 'Available')}` : 'Select a cell to inspect'}</span>
        </div>
      </div>
      <aside className="decision-pane hud-card" aria-label="AI decision">
        <button type="button" className="decision-toggle" aria-controls="decision-content" aria-expanded={detailsOpen}
          aria-label={detailsOpen ? 'Hide AI details' : 'Show AI details'} onClick={() => setDetailsOpen(!detailsOpen)}>
          <span><strong>{titles[state.step]}</strong>
            <small>{state.step === 'predicted' && state.decision
              ? `${state.decision.prediction.days.toFixed(1)} days · ${choice?.slot.id ?? 'No feasible cell'}`
              : `${current.id} · ${data.commodities[current.commodity]}`}</small></span>
          <ChevronDown size={16}/>
        </button>
        <div id="decision-content" className="decision-content" data-expanded={detailsOpen}>
          <section className="side-section cargo-section">
            <div className="section-heading"><Box size={16}/><h2>{state.step === 'arrived' || state.step === 'predicted' ? 'Incoming container' : 'Current container'}</h2></div>
            <strong className="cargo-id">{current.id}</strong>
            <span className="cargo-commodity">{data.commodities[current.commodity]}</span>
            <p>{data.ports[current.lane]} → {data.destinations[current.lane]}</p>
            <p>{data.receivers[current.receiver]?.name ?? 'Unseen receiver'}</p>
            <div className="cargo-specs"><span>{(current.kg/1000).toFixed(1)} t</span><span>{current.size} ft</span><span className="capitalize">{current.kind}</span>
              {current.priority > 0 && <span className="priority-chip">Priority {current.priority}</span>}</div>
            <details><summary>Arrival and handling</summary>
              <p>{formatDubai(state.floor.inventory.find((item) => item.cargo.id === current.id)?.arrived ?? state.clock)}</p>
              <p>{current.kind === 'reefer' ? 'Powered reefer slot required' : current.kind === 'hazard' ? 'Segregated hazardous cell required' : 'Standard dry handling'} · {current.customs ? 'Customs review' : 'Customs-ready'}</p>
              <p>Fictional vessel · {data.vessels[current.vessel]?.name}</p>
            </details>
          </section>
          {state.step === 'arrived' && <section className="side-section prediction-section">
            <div className="section-heading"><Sparkles size={17}/><h2>AI prediction</h2></div>
            <p>Select <strong>Next · Predict</strong> to estimate dwell and find a storage cell for this arrival.</p>
          </section>}
          {withPrediction && state.decision && <>
            <section className="side-section prediction-section">
              <div className="section-heading"><Sparkles size={17}/><h2>AI prediction</h2></div>
              <PredictionCard prediction={state.decision.prediction} previous={state.comparison}/>
            </section>
            <Factors prediction={state.decision.prediction}/>
            <section className="side-section placement-section"><h2>{state.step === 'placed' ? 'Placement complete' : state.override ? 'Selected alternative' : 'Recommended slot'}</h2>
              {choice ? <>
                <p className="slot-label">{choiceLabel(choice)}</p>
                {state.step === 'predicted' && state.override && state.decision.choices[0] && <p>Score +{(choice.score-state.decision.choices[0].score).toFixed(3)} vs AI recommendation.</p>}
                <p>Est. retrieval {choice.retrieval.seconds.toFixed(0)} s · Placement {choice.placement.kwh.toFixed(2)} kWh</p>
                {state.step === 'predicted' && <details><summary>Scores and alternatives</summary>
                  <p>Lower score balances placement, retrieval, capacity, workload and pickup urgency.</p>
                  {Object.entries(choice.components).map(([key, value]) => <div className="factor capitalize" key={key}><span>{key}</span><strong>{value.toFixed(3)}</strong></div>)}
                  <label className="alternative-label">Feasible slot<select value={choice.slot.id} aria-label="Feasible slot"
                    disabled={busy} onChange={(e) => commit({ ...state, override: e.currentTarget.value })}>
                    {state.decision.choices.map((item) => <option key={item.slot.id} value={item.slot.id}>{choiceLabel(item)} · {item.score.toFixed(3)}</option>)}
                  </select></label>
                  <p>{Object.entries(state.decision.rejected).map(([reason,count]) => `${count} ${reason.toLowerCase()}`).join(' · ')}</p>
                </details>}
              </> : <><p>No feasible cell. Container remains at inbound.</p>
                <p>{Object.entries(state.decision.rejected).map(([reason,count]) => `${reason} (${count})`).join(' · ')}</p></>}
            </section>
          </>}
          {state.step === 'review' && <section className="side-section placement-section">
            <div className="section-heading"><Zap size={16}/><h2>Optimization review</h2></div>
            {definition ? <>
              <p className="slot-label">{definition.plan.source} → {definition.plan.target.id}</p>
              <p>{definition.plan.cargo.id} · {definition.remaining.toFixed(1)} d estimated remaining</p>
              <div className="factor"><span>Pickup time saved</span><strong>{(definition.current.seconds-definition.proposed.seconds).toFixed(0)} s</strong></div>
              <div className="factor"><span>Relocation cost</span><strong>{definition.move.kwh.toFixed(2)} kWh · {definition.move.seconds.toFixed(0)} s</strong></div>
              <div className="factor"><span>Net projected benefit</span><strong className="green-text">{definition.benefit.toFixed(2)} AED</strong></div>
              <details><summary>Forecast and alternatives</summary><p>{definition.demand.arrivals.toFixed(0)} inbound and {definition.demand.pickups.toFixed(0)} pickups forecast in 24 h. {definition.demand.week.toFixed(0)} inbound in seven days.</p>
                <p>{Math.round(definition.probability*100)}% modeled pickup probability within two days. A move is ranked by expected future benefit after relocation energy, distance and idle-window time.</p>
                {state.advice?.slice(1).map((item) => <p key={item.plan.cargo.id + item.plan.target.id}>{item.plan.cargo.id} → {item.plan.target.id} · {item.benefit.toFixed(2)} AED</p>)}
              </details>
            </> : <p>{state.notice || 'Select Optimize to evaluate the current facility.'}</p>}
            {state.lastRelocation && <p>Last relocation · {state.lastRelocation.plan.cargo.id} · projected benefit AED {state.lastRelocation.benefit.toFixed(2)}.</p>}
          </section>}
          {state.notice && state.step !== 'review' && <p className="inline-notice" role="status">{state.notice}</p>}
        </div>
      </aside>
      {settings && <section className="condition-drawer hud-card" aria-label="Operating conditions">
        <div className="section-heading"><Settings2 size={17}/><h2>Operating conditions</h2>
          <button className="icon-button" onClick={() => setSettings(false)} aria-label="Close conditions"><ChevronDown size={18}/></button></div>
        {([['occupancy','Occupancy signal'],['congestion','Congestion'],['truck','Truck pickup capacity'],['vessel','Vessel pressure']] as const).map(([key,name]) =>
          <label key={key}>{name}<input type="number" min="0" max="1" step=".05" defaultValue={state.operation[key]} key={state.operation[key]}
            onBlur={(e) => { const value = e.currentTarget.valueAsNumber; if (Number.isFinite(value) && value !== state.operation[key])
              context({ ...state.operation, [key]: Math.max(0,Math.min(1,value)) }, dubaiDate(state.clock)) }} disabled={busy}/></label>)}
        <label>Online cranes<select value={state.operation.cranes} disabled={busy} onChange={(e) =>
          context({ ...state.operation, cranes: Number(e.currentTarget.value) }, dubaiDate(state.clock))}>
          <option value={2}>Both</option><option value={1}>One</option><option value={0}>None</option>
        </select></label>
        <h3>Illustrative cost assumptions</h3>
        {([['electricity','Electricity · AED/kWh'],['equipment','Equipment · AED/km'],['time','Operations · AED/h'],
          ['emissions','Emissions · kg CO₂e/kWh'],['usd','USD per AED']] as const).map(([key,name]) => <label key={key}>{name}
          <input type="number" min="0" step=".01" defaultValue={state.rates[key]} key={state.rates[key]} disabled={busy}
            onBlur={(e) => {const value = e.currentTarget.valueAsNumber; if (value >= 0 && value !== state.rates[key]) changeRates(key,value)}}/></label>)}
        {due && <button className="button" disabled={busy} onClick={collect}>Dispatch due pickup</button>}
      </section>}
      <div className="demo-dock">
        {message && <p className="inline-alert hud-card" role="alert"><CircleHelp size={15}/>{message}</p>}
        <Impact state={state} data={data}/>
        <div className="action-bar hud-card">
          <button type="button" className="button subdued new-session" disabled={busy} onClick={() => {
            reset(initialize(data, bundle)); setSelected(undefined); setMessage('')
          }}><RotateCcw size={15}/> New session</button>
          <div className="step-actions">
            <button type="button" className="button" disabled={busy || !history.length} onClick={() => {
              previous(); setMessage('')
            }}><ArrowLeft size={15}/> Previous</button>
            <div className="step-status" aria-live="polite"><strong>Step {steps[state.step]} / 4</strong><small>{busy ? 'Operation in progress' : titles[state.step]}</small></div>
            <button type="button" className="button primary" disabled={busy || state.step === 'predicted' && !choice ||
              state.step === 'review' && state.cargoIndex + 1 >= data.incoming.length} onClick={next}>
              {state.step === 'review' ? label : `Next · ${label}`}<ArrowRight size={15}/></button>
          </div>
          <div className="opt-actions"><button type="button" className="button optimize" disabled={busy || state.step !== 'review'}
            onClick={() => void attempt(() => optimize(state, true))}><Zap size={15}/> Optimize</button>
            <label className="auto"><input type="checkbox" aria-label="Auto-optimize" checked={state.auto} disabled={busy}
              onChange={(e) => commit({ ...state, auto: e.currentTarget.checked })}/> Auto-optimize</label></div>
        </div>
      </div>
    </div>
  </div>
}
