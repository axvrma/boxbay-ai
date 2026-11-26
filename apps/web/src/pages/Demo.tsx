import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Box, CalendarDays, ChevronDown, CircleHelp, Clock3, Factory, Gauge,
  Maximize, Minimize, RotateCcw, Settings2, Sparkles, Zap } from 'lucide-react'
import { useStore } from 'zustand'
import { dubaiDate, formatDubai } from '../intelligence/inference'
import type { Bundle, Prediction } from '../intelligence/inference'
import { changeConditions, conditions, evaluate, incomingCargo, initialize, makePickup, apply,
  elapsedIdle, occupied, partialPlacement, placementRestriction, projectedRetrieval } from '../simulation/engine'
import type { Plan, State } from '../simulation/engine'
import { cost, movement } from '../simulation/physics'
import type { Leg } from '../simulation/physics'
import { createSession } from '../simulation/session'
import type { DemoData, Operating, Rack, Rates, Slot } from '../simulation/types'
import type { Animation, Camera } from '../three/FacilityView'

const View = lazy(() => import('../three/FacilityView'))
const steps = { arrived: 1, predicted: 2, placed: 3 }
const actions = { arrived: 'Predict', predicted: 'Place container', placed: 'Next container' }
const titles = { arrived: 'Container arrives', predicted: 'AI prediction', placed: 'Container placed' }
const handlingLabels: Record<Leg['phase'], string> = {
  pallet: 'Rail pallet moving',
  grip: 'Spreader locking onto container',
  lift: 'Lifting clear of support',
  travel: 'Stacker travelling and hoisting',
  extend: 'Spreader extending sideways',
  'set-down': 'Setting container down',
  release: 'Spreader releasing container',
  retract: 'Spreader retracting into aisle',
}
const signed = (value: number, decimals: number) => `${value > .0001 ? '+' : value < -.0001 ? '−' : ''}${Math.abs(value).toFixed(decimals)}`
const slotLabel = (slot: Slot) => `Rack ${slot.rack} · Row ${slot.level} · Column ${String(slot.bay).padStart(2, '0')}`

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
      <small>{actual.moves} {actual.moves === 1 ? 'move' : 'moves'} · {(actual.kwh * state.rates.emissions).toFixed(2)} kg CO₂e est.</small></div>
  </section>
}

export default function Demo({ data, bundle }: { data: DemoData; bundle: Bundle }) {
  const session = useMemo(() => createSession(initialize(data, bundle)), [data, bundle])
  const { state, history, commit, previous, reset } = useStore(session)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [animation, setAnimation] = useState<Animation>()
  const [handlingPhase, setHandlingPhase] = useState<Leg['phase']>()
  const [camera, setCamera] = useState<Camera>('isometric')
  const [cameraVersion, setCameraVersion] = useState(0)
  const [map, setMap] = useState(false)
  const [selected, setSelected] = useState<string>()
  const [settings, setSettings] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const locked = useRef(false)
  const mounted = useRef(true)
  const movementTimer = useRef<number>(undefined)
  const recommended = state.decision?.choices[0]
  const choice = state.override ? state.decision?.choices.find((item) => item.slot.id === state.override) : recommended
  const manualSlot = data.cells.find((cell) => cell.id === state.override)
  const position = manualSlot ?? recommended?.slot ?? data.cells[0]
  const current = incomingCargo(state, data)!
  const vendor = data.receivers[current.receiver]?.name ?? 'Unknown vendor'
  const selectionError = state.step === 'predicted' && manualSlot && placementRestriction(current, manualSlot, conditions(state), occupied(state.floor))
  const picked = data.cells.find((cell) => cell.id === selected)
  const selectedCargo = state.floor.inventory.find((item) => item.slot === selected)
  const due = state.floor.inventory.filter((item) => item.ready <= state.clock)
    .find((item) => makePickup(data, state.floor, item, state.operation))
  const target = animation?.plan.target ?? (state.step === 'predicted' ? choice?.slot : undefined)
  const stackerStatus = state.operation.cranes === 2 ? 'Online' :
    state.operation.cranes === 1 ? (state.operation.id === 'reduced' ? 'Rack B only' : 'Rack A only') : 'Offline'
  const withPrediction = state.step === 'predicted' || state.step === 'placed'
  const label = actions[state.step]

  useEffect(() => {
    mounted.current = true
    const isFullscreen = () => setFullscreen(document.fullscreenElement?.id === 'root')
    document.addEventListener('fullscreenchange', isFullscreen)
    return () => {
      mounted.current = false
      window.clearTimeout(movementTimer.current)
      document.removeEventListener('fullscreenchange', isFullscreen)
    }
  }, [])

  useEffect(() => {
    if (!animation) return
    const total = movement(animation.plan.legs).seconds
    const elapsed = performance.now() - animation.start
    let seconds = 0
    const timers = animation.plan.legs.map((leg) => {
      const at = seconds / total * animation.duration - elapsed
      seconds += leg.seconds
      return window.setTimeout(() => setHandlingPhase(leg.phase), Math.max(0, at))
    })
    return () => timers.forEach((timer) => window.clearTimeout(timer))
  }, [animation])

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
    const duration = Math.max(5400, Math.min(8200, movement(plan.legs).seconds * 180))
    setHandlingPhase(plan.legs[0].phase)
    setAnimation({ plan, duration, start: performance.now() })
    await new Promise<void>((resolve) => { movementTimer.current = window.setTimeout(resolve, duration) })
    if (mounted.current) setAnimation(undefined)
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
      } else if (state.step === 'placed' && state.cargoIndex + 1 < data.incoming.length) {
        commit({ ...state, step: 'arrived', cargoIndex: state.cargoIndex + 1, decision: null,
          comparison: undefined, override: undefined, priorityOverride: undefined, notice: '' })
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
      } else commit(changed)
    })
  }

  function setPriority(priority: number) {
    if (priority === current.priority) return
    const updated = { ...state, priorityOverride: priority, notice: '' }
    commit(state.step === 'predicted'
      ? { ...updated, comparison: state.decision?.prediction, decision: evaluate(updated, data, bundle) }
      : updated)
  }

  function setPosition(change: Partial<Pick<Slot, 'rack' | 'level' | 'bay'>>) {
    const wanted = { ...position, ...change }
    const cells = data.cells.filter((cell) => cell.rack === wanted.rack)
    const next = cells.find((cell) => cell.level === wanted.level && cell.bay === wanted.bay) ??
      cells.find((cell) => cell.level === wanted.level) ?? cells[0]
    if (next) commit({ ...state, override: next.id })
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
        step: state.step === 'predicted' ? 'arrived' as const : state.step,
        decision: state.step === 'predicted' ? null : state.decision, notice: `${plan.cargo.id} delivered to outbound transfer.` }
      await animate(plan)
      if (mounted.current) commit(after)
    })
  }

  const changeRates = (key: keyof Rates, value: number) => commit({ ...state, rates: { ...state.rates, [key]: value } })
  return <div className="demo-shell">
    <section className="twin-panel" aria-label="Facility viewer">
      <div className="viewport"><Suspense fallback={<div className="view-status">Preparing 3D facility…</div>}>
        <View data={data} state={state} target={target} selected={selected} onSelect={setSelected}
            camera={camera} cameraVersion={cameraVersion} animation={animation} manualTarget={!!state.override} map={map}/>
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
            <small>Stacker crane</small><strong>{stackerStatus}</strong></span></div>
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
            <span className="long">Long</span><span className={state.override ? "manual-slot" : "recommended"}>{state.override ? "Custom position" : "Recommended"}</span><span className="priority">Priority</span>
            <span className="restricted">Restricted</span></div>
          {animation && handlingPhase && <span className="motion-status" role="status">{handlingLabels[handlingPhase]}</span>}
          <span className="inspection" data-selected={Boolean(picked)}>{picked ? `${picked.id} · ${selectedCargo?.cargo.id ?? (picked.blocked ? 'Restricted' : 'Available')}` : 'Select a cell to inspect'}</span>
        </div>
      </div>
      <aside className="decision-pane hud-card" aria-label="AI decision">
        <button type="button" className="decision-toggle" aria-controls="decision-content" aria-expanded={detailsOpen}
          aria-label={detailsOpen ? 'Hide AI details' : 'Show AI details'} onClick={() => setDetailsOpen(!detailsOpen)}>
          <span><strong>{titles[state.step]}</strong>
            <small>{state.step === 'predicted' && state.decision
              ? `${state.decision.prediction.days.toFixed(1)} days · ${choice?.slot.id ?? 'No feasible cell'}`
              : current.id} · {vendor}</small></span>
          <ChevronDown size={16}/>
        </button>
        <div id="decision-content" className="decision-content" data-expanded={detailsOpen}>
          <section className="side-section cargo-section">
            <div className="section-heading"><Box size={16}/><h2>{state.step === 'arrived' || state.step === 'predicted' ? 'Incoming container' : 'Current container'}</h2></div>
            <strong className="cargo-id">{current.id}</strong>
            <span className="cargo-commodity">{data.commodities[current.commodity]}</span>
            <p>{data.ports[current.lane]} → {data.destinations[current.lane]}</p>
            {state.step !== 'predicted' && <p className="vendor-name">Vendor · <strong>{vendor}</strong></p>}
            <div className="cargo-specs"><span>{(current.kg/1000).toFixed(1)} t</span><span>{current.size} ft</span><span className="capitalize">{current.kind}</span>
              {state.step === 'placed' && current.priority > 0 && <span className="priority-chip">Priority {current.priority}</span>}</div>
            {state.step !== 'placed' && <label className="priority-field">Handling priority
              <select value={current.priority} disabled={busy} onChange={(e) => setPriority(Number(e.currentTarget.value))}>
                <option value={0}>Standard</option><option value={1}>Elevated</option><option value={2}>Urgent</option>
              </select>
            </label>}
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
              {state.step === 'predicted' && <p className="vendor-name">Vendor · <strong>{vendor}</strong></p>}
              <PredictionCard prediction={state.decision.prediction} previous={state.comparison}/>
            </section>
            <Factors prediction={state.decision.prediction}/>
            <section className="side-section placement-section">
              <h2>{state.step === 'placed' ? 'Placement complete' : state.override ? 'Custom position' : 'Recommended slot'}</h2>
              {choice && <>
                <p className={state.override ? "slot-label custom-position" : "slot-label"}>{slotLabel(choice.slot)}</p>
                <p>Est. retrieval {choice.retrieval.seconds.toFixed(0)} s · Placement {choice.placement.kwh.toFixed(2)} kWh</p>
                {state.override && recommended && choice.slot.id !== recommended.slot.id && <p>AI suggestion · {slotLabel(recommended.slot)}</p>}
              </>}
              {selectionError && <p className="position-error" role="status">{slotLabel(manualSlot!)} is unavailable. {selectionError}.</p>}
              {!choice && !manualSlot && <p>No feasible cell. Container remains at inbound.</p>}
              {state.step === 'predicted' && <>
                <details onToggle={(e) => {
                  if (e.currentTarget.open) e.currentTarget.scrollIntoView({ block: 'nearest' })
                }}>
                  <summary>Override position</summary>
                  <div className="position-fields">
                    <label>Rack<select value={position.rack} disabled={busy} onChange={(e) => setPosition({ rack: e.currentTarget.value as Rack })}>
                      {[...new Set(data.cells.map((cell) => cell.rack))].map((rack) => <option key={rack}>{rack}</option>)}
                    </select></label>
                    <label>Row<select value={position.level} disabled={busy} onChange={(e) => setPosition({ level: Number(e.currentTarget.value) })}>
                      {[...new Set(data.cells.filter((cell) => cell.rack === position.rack).map((cell) => cell.level))]
                        .map((row) => <option key={row}>{row}</option>)}
                    </select></label>
                    <label>Column<select value={position.bay} disabled={busy} onChange={(e) => setPosition({ bay: Number(e.currentTarget.value) })}>
                      {data.cells.filter((cell) => cell.rack === position.rack && cell.level === position.level)
                        .map((cell) => <option key={cell.id} value={cell.bay}>{cell.bay}</option>)}
                    </select></label>
                  </div>
                  {state.override && <button type="button" className="button subdued" disabled={busy}
                    onClick={() => commit({ ...state, override: undefined })}>Use AI slot</button>}
                </details>
                <details><summary>Placement scores</summary>
                  <p>Lower scores balance placement, retrieval, capacity, workload and pickup urgency.</p>
                  {choice && Object.entries(choice.components).map(([key, value]) =>
                    <div className="factor capitalize" key={key}><span>{key}</span><strong>{value.toFixed(3)}</strong></div>)}
                  <p>{Object.entries(state.decision.rejected).map(([reason, count]) => `${count} ${reason.toLowerCase()}`).join(' · ')}</p>
                </details>
              </>}
            </section>
          </>}
          {state.notice && <p className="inline-notice" role="status">{state.notice}</p>}
        </div>
      </aside>
      {settings && <section className="condition-drawer hud-card" aria-label="Operating conditions">
        <div className="section-heading"><Settings2 size={17}/><h2>Operating conditions</h2>
          <button className="icon-button" onClick={() => setSettings(false)} aria-label="Close conditions"><ChevronDown size={18}/></button></div>
        {([['occupancy','Occupancy signal'],['congestion','Congestion'],['truck','Truck pickup capacity'],['vessel','Vessel pressure']] as const).map(([key,name]) =>
          <label key={key}>{name}<input type="number" min="0" max="1" step=".05" defaultValue={state.operation[key]} key={state.operation[key]}
            onBlur={(e) => { const value = e.currentTarget.valueAsNumber; if (Number.isFinite(value) && value !== state.operation[key])
              context({ ...state.operation, [key]: Math.max(0,Math.min(1,value)) }, dubaiDate(state.clock)) }} disabled={busy}/></label>)}
        <label>Crane access<select value={state.operation.cranes} disabled={busy} onChange={(e) =>
          context({ ...state.operation, cranes: Number(e.currentTarget.value) }, dubaiDate(state.clock))}>
          <option value={2}>Both racks</option><option value={1}>One rack</option><option value={0}>Offline</option>
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
          <button type="button" className="button subdued new-session" title="New session" disabled={busy} onClick={() => {
            reset(initialize(data, bundle)); setSelected(undefined); setMessage('')
          }}><RotateCcw size={15}/> New session</button>
          <div className="step-actions">
            <button type="button" className="button" disabled={busy || !history.length} onClick={() => {
              previous(); setMessage('')
            }}><ArrowLeft size={15}/> Previous</button>
            <div className="step-status" aria-live="polite"><strong>Step {steps[state.step]} / 3</strong><small>{busy ? 'Operation in progress' : titles[state.step]}</small></div>
            <button type="button" className="button primary" disabled={busy || state.step === 'predicted' && !choice ||
              state.step === 'placed' && state.cargoIndex + 1 >= data.incoming.length} onClick={next}>
              {state.step === 'placed' ? label : `Next · ${label}`}<ArrowRight size={15}/></button>
          </div>
        </div>
      </div>
    </div>
  </div>
}
