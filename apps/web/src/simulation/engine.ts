import { DAY, dubaiDate, dubaiTime, dwellFeatures, forecast, infer, predict } from '../intelligence/inference'
import type { Bundle, Forecast, Prediction } from '../intelligence/inference'
import { craneHome, inbound, movement, physics, pickupLegs, storeLegs } from './physics'
import type { Leg, Movement } from './physics'
import type { Cargo, DemoData, Operating, Point, Rack, Rates, Slot } from './types'

export type Stored = { cargo: Cargo; slot: string; arrived: number; ready: number; days: number }
type Stacker = { at: Point; served: Record<Rack, number> }
export type Policy = 'first' | 'nearest' | 'tier' | 'ai'
export type Metrics = Movement & {
  moves: number; placements: number; pickups: number; onTime: number; retrievalSeconds: number
}
export type Facility = {
  inventory: Stored[]
  stacker: Stacker
  trayAt: Point
  metrics: Metrics
}
type Step = 'arrived' | 'predicted' | 'placed'
export type State = {
  clock: number; capacity: number; cargoIndex: number; operation: Operating; floor: Facility; baseline: Facility
  cells: readonly Slot[]
  step: Step; decision: Decision | null; comparison?: Prediction; override?: string; priorityOverride?: number; rates: Rates; notice: string
}
export type Plan = {
  kind: 'placement' | 'pickup'; cargo: Cargo; source: string | null; target: Slot; legs: Leg[]
}
export type Ranking = {
  slot: Slot; placement: Movement; retrieval: Movement; score: number
  components: { placement: number; retrieval: number; capacity: number; workload: number; sla: number }
}
export type Decision = {
  prediction: Prediction; forecast: Forecast; choices: Ranking[]; rejected: Record<string, number>
}
const emptyMetrics = (): Metrics => ({
  seconds: 0, metres: 0, kwh: 0, moves: 0, placements: 0, pickups: 0, onTime: 0, retrievalSeconds: 0,
})
const weights = { placement: .30, retrieval: .37, capacity: .18, workload: .08, sla: .07 }

function seedFloor(data: DemoData, bundle: Bundle, clock: number, operating: Operating): Facility {
  const inventory = data.initial.map(({ cargo, slot, ageDays, actualDwellDays, arrivalScenario }) => {
    const arrived = clock - ageDays * DAY
    const arrivalConditions = data.scenarios.find((entry) => entry.id === arrivalScenario) ?? operating
    const days = infer(bundle.models.dwell, dwellFeatures(cargo, dubaiDate(arrived), arrivalConditions, data))
    return { cargo, slot, arrived, days, ready: arrived + actualDwellDays * DAY }
  })
  return { inventory, stacker: { at: craneHome, served: { A: 0, B: 0 } }, trayAt: inbound, metrics: emptyMetrics() }
}

export function initialize(data: DemoData, bundle: Bundle, date = data.defaultDate): State {
  const clock = dubaiTime(date)
  const operation = data.scenarios[0]
  const floor = seedFloor(data, bundle, clock, operation)
  return {
    clock, capacity: data.cells.length, operation, floor, baseline: structuredClone(floor), cargoIndex: 0, step: 'arrived',
    cells: data.cells, decision: null, rates: data.rates, notice: '',
  }
}

export const occupied = (facility: Facility) => new Map(facility.inventory.map((item) => [item.slot, item]))
export const craneOnline = (rack: Rack, context: Operating) =>
  context.cranes > (rack === (context.id === 'reduced' ? 'A' : 'B') ? 1 : 0)

export function restriction(cargo: Cargo, slot: Slot, context: Operating) {
  if (slot.blocked) return 'Restricted cell'
  if (!craneOnline(slot.rack, context)) return 'Rack crane unavailable'
  if (!slot.sizes.includes(cargo.size)) return 'Container size'
  if (cargo.kg > slot.maxKg || cargo.kg > (cargo.size === 20 ? 28_000 : 36_000)) return 'Weight limit'
  if (cargo.kind === 'reefer' && !slot.reefer) return 'Reefer power required'
  if (slot.hazard !== (cargo.kind === 'hazard')) return 'Hazardous segregation'
  if (slot.reserved && cargo.priority < 2) return 'Reserved for urgent cargo'
  return null
}

export function placementRestriction(cargo: Cargo, slot: Slot, context: Operating, slots: ReadonlyMap<string, Stored>) {
  return restriction(cargo, slot, context) ?? (slots.has(slot.id) ? 'Occupied' : null)
}

export function incomingCargo(state: State, data: DemoData): Cargo | undefined {
  const cargo = data.incoming[state.cargoIndex]
  return cargo && state.priorityOverride !== undefined ? { ...cargo, priority: state.priorityOverride } : cargo
}

export function rankings(
  cells: readonly Slot[], facility: Facility, cargo: Cargo, operating: Operating, days: number, demand: Forecast,
) {
  const slots = occupied(facility)
  const rejected: Record<string, number> = {}
  const choices: Ranking[] = []
  for (const slot of cells) {
    const block = placementRestriction(cargo, slot, operating, slots)
    if (block) {
      rejected[block] = (rejected[block] ?? 0) + 1
      continue
    }
    const placement = movement(storeLegs(slot, cargo.kg, facility.stacker.at, facility.trayAt), operating.cranes)
    const retrieval = movement(pickupLegs(slot, cargo.kg, craneHome), operating.cranes)
    const urgency = Math.min(1, .5 / Math.max(.5, days) + .18 * cargo.priority + .30 * (1 - operating.truck))
    const components = {
      placement: weights.placement * (.56 * placement.kwh / 1.8 + .44 * placement.metres / 105),
      retrieval: weights.retrieval * (.22 + 1.45 * urgency) * (.72 * retrieval.seconds / 90 + .28 * retrieval.kwh / 1.6),
      capacity: weights.capacity * demand.pressure * ((1 - urgency) * Math.max(0, (5 - slot.bay) / 4) +
        (slot.reefer && cargo.kind !== 'reefer' ? .7 : 0)),
      workload: weights.workload * facility.stacker.served[slot.rack] / Math.max(1, facility.metrics.moves),
      sla: weights.sla * urgency * (retrieval.seconds / 65) ** 2,
    }
    choices.push({ slot, placement, retrieval, components, score: Object.values(components).reduce((a,b) => a+b, 0) })
  }
  choices.sort((a, b) => a.score - b.score || a.slot.id.localeCompare(b.slot.id))
  return { choices, rejected }
}

export function pickPolicy(choices: Ranking[], policy: Policy, days: number) {
  if (policy === 'ai') return choices[0]
  return choices.slice().sort((a, b) => {
    if (policy === 'nearest') return a.placement.metres - b.placement.metres || a.slot.id.localeCompare(b.slot.id)
    if (policy === 'tier') {
      const target = days < 3 ? 1 : days < 6 ? 2 : 4
      return Math.abs(a.slot.level-target) - Math.abs(b.slot.level-target) || a.slot.id.localeCompare(b.slot.id)
    }
    return a.slot.id.localeCompare(b.slot.id)
  })[0]
}

export function evaluate(state: State, data: DemoData, bundle: Bundle): Decision | null {
  const cargo = incomingCargo(state, data)
  if (!cargo) return null
  const operating = conditions(state)
  const prediction = predict(bundle, data, cargo, state.clock, operating)
  const demand = forecast(bundle, data, state.clock, operating)
  return { prediction, forecast: demand,
    ...rankings(state.cells, state.floor, cargo, operating, prediction.days, demand) }
}

export function setSlotRestriction(state: State, data: DemoData, slotId: string, blocked: boolean): State {
  const slot = state.cells.find((cell) => cell.id === slotId)
  if (!slot || slot.blocked === blocked) return state
  const next = { ...state, cells: state.cells.map((cell) => cell === slot ? { ...cell, blocked } : cell) }
  const cargo = incomingCargo(state, data)
  if (state.step === 'predicted' && state.decision && cargo) {
    next.decision = { ...state.decision, ...rankings(next.cells, state.floor, cargo,
      conditions(state), state.decision.prediction.days, state.decision.forecast) }
  }
  return next
}

export function conditions(state: State): Operating {
  const physical = (state.floor.inventory.length + state.baseline.inventory.length) / 2 / state.capacity
  return { ...state.operation, occupancy: Math.min(1, Math.max(.05, physical + state.operation.occupancy - .65)) }
}

export function makePlacement(facility: Facility, cargo: Cargo, slot: Slot): Plan {
  return { kind: 'placement', cargo, target: slot, source: null,
    legs: storeLegs(slot, cargo.kg, facility.stacker.at, facility.trayAt) }
}

export function makePickup(cells: readonly Slot[], facility: Facility, item: Stored, context: Operating): Plan | null {
  const slot = cells.find((cell) => cell.id === item.slot)
  if (!slot || slot.blocked || !craneOnline(slot.rack, context)) return null
  return { kind: 'pickup', target: slot, source: slot.id, cargo: item.cargo,
    legs: pickupLegs(slot, item.cargo.kg, facility.stacker.at, facility.trayAt) }
}

export function nextCompatiblePickup(state: State, data: DemoData) {
  const cargo = incomingCargo(state, data)
  if (!cargo) return undefined
  return state.floor.inventory.toSorted((a, b) => a.ready - b.ready).find((item) => {
    const slot = state.cells.find((cell) => cell.id === item.slot)
    return slot && !restriction(cargo, slot, state.operation) && dubaiDate(Math.max(item.ready, state.clock)) <= data.dateMax
  })
}

export function apply(facility: Facility, plan: Plan, context: Operating, clock: number, days: number, actualDwell: number, requestedAt = clock): Facility {
  const bySlot = occupied(facility)
  const here = plan.source === null ? undefined : bySlot.get(plan.source)
  const rack = plan.target.rack
  if ((plan.kind !== 'placement' && here?.cargo.id !== plan.cargo.id) ||
      (plan.kind === 'placement' && facility.inventory.some((item) => item.cargo.id === plan.cargo.id)) ||
      !craneOnline(rack, context) || plan.target.blocked ||
      (plan.kind === 'placement' && placementRestriction(plan.cargo, plan.target, context, bySlot))) {
    throw Error('The move is no longer valid for the current facility state.')
  }
  const measured = movement(plan.legs, context.cranes)
  const inventory = facility.inventory.filter((item) => item !== here)
  if (plan.kind === 'placement') inventory.push({
    cargo: plan.cargo, slot: plan.target.id, arrived: clock, ready: clock + actualDwell * DAY, days,
  })
  const lastCrane = plan.legs.findLast((leg) => leg.equipment === 'crane')
  const lastTray = plan.legs.findLast((leg) => leg.equipment === 'tray')
  const previous = facility.metrics
  return {
    inventory,
    trayAt: lastTray?.to ?? facility.trayAt,
    stacker: { at: lastCrane?.to ?? facility.stacker.at,
      served: { ...facility.stacker.served, [rack]: facility.stacker.served[rack] + 1 } },
    metrics: { seconds: previous.seconds + measured.seconds, metres: previous.metres + measured.metres,
      kwh: previous.kwh + measured.kwh, moves: previous.moves + 1,
      placements: previous.placements + Number(plan.kind === 'placement'),
      pickups: previous.pickups + Number(plan.kind === 'pickup'),
      onTime: previous.onTime + Number(plan.kind === 'pickup' && measured.seconds + Math.max(0, clock - requestedAt) / 1000 <= 60),
      retrievalSeconds: previous.retrievalSeconds + (plan.kind === 'pickup' ? measured.seconds : 0),
    },
  }
}

export function elapsedIdle(facility: Facility, seconds: number, rackAccess: number): Facility {
  return { ...facility, metrics: { ...facility.metrics, kwh: facility.metrics.kwh +
    physics.idleKw * Number(rackAccess > 0) * Math.max(0, seconds) / 3600 } }
}

export function partialPlacement(state: State, data: DemoData, choice: Ranking) {
  const decision = state.decision
  const cargo = incomingCargo(state, data)
  if (!decision || !cargo || state.step !== 'predicted') throw Error('Run a prediction before placing cargo.')
  const slot = state.cells.find((cell) => cell.id === choice.slot.id)
  if (!slot || !decision.choices.some((candidate) => candidate.slot.id === slot.id) ||
      state.override && slot.id !== state.override) throw Error('Choose a feasible storage position.')
  const plan = makePlacement(state.floor, cargo, slot)
  const operating = conditions(state)
  const actualDwell = 2 + (state.cargoIndex * 37 % 67) / 10
  const floor = apply(state.floor, plan, operating, state.clock, decision.prediction.days, actualDwell)
  const conventional = pickPolicy(rankings(state.cells, state.baseline, cargo, operating, decision.prediction.days,
    decision.forecast).choices, 'first', decision.prediction.days)
  const baselinePlan = conventional ? makePlacement(state.baseline, cargo, conventional.slot) : null
  const baseFloor = baselinePlan ? apply(state.baseline, baselinePlan, operating, state.clock, decision.prediction.days, actualDwell) : state.baseline
  const time = movement(plan.legs, operating.cranes).seconds
  const baseTime = baselinePlan ? movement(baselinePlan.legs, operating.cranes).seconds : 0
  const wall = Math.max(time, baseTime)
  return { plan, next: { ...state, floor: elapsedIdle(floor, wall-time, operating.cranes),
    baseline: elapsedIdle(baseFloor, wall-baseTime, operating.cranes),
    clock: state.clock + Math.round(wall * 1000), step: 'placed' as const,
    notice: baselinePlan ? '' : 'First-available policy could not place this container.' } }
}

export function partialPickup(state: State, data: DemoData, bundle: Bundle, item: Stored, dispatchAt = state.clock) {
  const plan = makePickup(state.cells, state.floor, item, state.operation)
  if (!plan || dispatchAt < Math.max(state.clock, item.ready)) return null
  const other = state.baseline.inventory.find((entry) => entry.cargo.id === item.cargo.id && entry.ready <= dispatchAt)
  const basePlan = other && makePickup(state.cells, state.baseline, other, state.operation)
  const access = state.operation.cranes
  const seconds = movement(plan.legs, access).seconds
  const baselineSeconds = basePlan ? movement(basePlan.legs, access).seconds : 0
  const wall = Math.max(seconds, baselineSeconds)
  const floor = apply(state.floor, plan, state.operation, dispatchAt, item.days, 0)
  const baseline = basePlan ? apply(state.baseline, basePlan, state.operation, dispatchAt, item.days, 0) : state.baseline
  const next: State = {
    ...state,
    clock: dispatchAt + Math.round(wall * 1000),
    floor: elapsedIdle(floor, wall - seconds, access),
    baseline: elapsedIdle(baseline, wall - baselineSeconds, access),
    notice: `${item.cargo.id} delivered to outbound transfer. ${plan.target.id} is available.`,
  }
  if (state.step === 'predicted') {
    next.comparison = state.decision?.prediction
    next.decision = evaluate(next, data, bundle)
    if (!state.decision?.choices.length && !next.decision?.choices.some(({ slot }) => slot.id === state.override)) {
      next.override = undefined
    }
  }
  return { plan, next }
}

export function changeConditions(state: State, operation: Operating, date: string) {
  const clock = date === dubaiDate(state.clock) ? state.clock : dubaiTime(date)
  const committed = state.floor.metrics.moves > 0 || state.baseline.metrics.moves > 0
  if (!Number.isFinite(clock) || clock < state.clock && committed) return state
  const change = clock - state.clock
  const rebase = (facility: Facility) => !committed && change !== 0 ? {
    ...facility, inventory: facility.inventory.map((item) => ({
      ...item, arrived: item.arrived + change, ready: item.ready + change,
    })),
  } : facility
  return { ...state, operation, clock, floor: rebase(state.floor), baseline: rebase(state.baseline),
    decision: state.step === 'predicted' ? null : state.decision,
    step: state.step === 'predicted' ? 'arrived' as const : state.step, notice: '' }
}

export function projectedRetrieval(cells: readonly Slot[], facility: Facility, operating: Operating) {
  const available = facility.inventory.flatMap((item) => {
    const slot = cells.find((cell) => cell.id === item.slot)
    return slot && !slot.blocked && craneOnline(slot.rack, operating)
      ? [movement(pickupLegs(slot, item.cargo.kg, craneHome), operating.cranes).seconds] : []
  })
  return available.length ? available.reduce((sum, seconds) => sum + seconds, 0) / available.length : null
}
