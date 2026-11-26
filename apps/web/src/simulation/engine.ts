import { DAY, dubaiDate, dubaiTime, dwellFeatures, forecast, infer, predict } from '../intelligence/inference'
import type { Bundle, Forecast, Prediction } from '../intelligence/inference'
import { cost, home, inbound, movement, physics, pickupLegs, relocationLegs, storeLegs } from './physics'
import type { Leg, Movement } from './physics'
import type { Cargo, DemoData, Operating, Point, Rack, Rates, Slot } from './types'

export type Stored = { cargo: Cargo; slot: string; arrived: number; ready: number; days: number }
export type Fleet = Record<Rack, { at: Point; completed: number }>
export type Policy = 'first' | 'nearest' | 'tier' | 'ai'
export type Metrics = Movement & {
  moves: number; placements: number; pickups: number; onTime: number; retrievalSeconds: number; relocations: number
}
export type Facility = {
  inventory: Stored[]
  fleet: Fleet
  trayAt: Point
  metrics: Metrics
  moved: string[]
}
type Step = 'arrived' | 'predicted' | 'placed' | 'review'
export type State = {
  clock: number; capacity: number; cargoIndex: number; operation: Operating; floor: Facility; baseline: Facility
  step: Step; decision: Decision | null; comparison?: Prediction; override?: string; lastRelocation?: Opportunity; advice: Opportunity[] | null; auto: boolean; rates: Rates; notice: string
}
export type Plan = {
  kind: 'placement' | 'relocation' | 'pickup'; cargo: Cargo; source: string | null; target: Slot; legs: Leg[]
}
export type Ranking = {
  slot: Slot; placement: Movement; retrieval: Movement; score: number
  components: { placement: number; retrieval: number; capacity: number; workload: number; sla: number }
}
export type Decision = {
  prediction: Prediction; forecast: Forecast; choices: Ranking[]; rejected: Record<string, number>
}
export type Opportunity = {
  plan: Plan; current: Movement; proposed: Movement; move: Movement
  remaining: number; probability: number; benefit: number; demand: Forecast
}
const emptyMetrics = (): Metrics => ({
  seconds: 0, metres: 0, kwh: 0, moves: 0, placements: 0, pickups: 0, onTime: 0, retrievalSeconds: 0, relocations: 0,
})
export const assumptions = { horizonDays: 2, minimumBenefitAED: .08, earlyStagingTimeFactor: .35 }
const weights = { placement: .30, retrieval: .37, capacity: .18, workload: .08, sla: .07 }

function seedFloor(data: DemoData, bundle: Bundle, clock: number, operating: Operating): Facility {
  const inventory = data.initial.map(({ cargo, slot, ageDays, actualDwellDays, arrivalScenario }) => {
    const arrived = clock - ageDays * DAY
    const arrivalConditions = data.scenarios.find((entry) => entry.id === arrivalScenario) ?? operating
    const days = infer(bundle.models.dwell, dwellFeatures(cargo, dubaiDate(arrived), arrivalConditions, data))
    return { cargo, slot, arrived, days, ready: arrived + actualDwellDays * DAY }
  })
  return { inventory, fleet: { A: { at: home('A'), completed: 0 }, B: { at: home('B'), completed: 0 } },
    trayAt: inbound, metrics: emptyMetrics(), moved: [] }
}

export function initialize(data: DemoData, bundle: Bundle, date = data.defaultDate): State {
  const clock = dubaiTime(date)
  const operation = data.scenarios[0]
  const floor = seedFloor(data, bundle, clock, operation)
  return {
    clock, capacity: data.cells.length, operation, floor, baseline: structuredClone(floor), cargoIndex: 0, step: 'arrived',
    decision: null, advice: null, auto: false, rates: data.rates, notice: '',
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

export function rankings(
  data: DemoData, facility: Facility, cargo: Cargo, operating: Operating, days: number, demand: Forecast,
) {
  const slots = occupied(facility)
  const rejected: Record<string, number> = {}
  const choices: Ranking[] = []
  for (const slot of data.cells) {
    const block = restriction(cargo, slot, operating) ?? (slots.has(slot.id) ? 'Occupied' : null)
    if (block) {
      rejected[block] = (rejected[block] ?? 0) + 1
      continue
    }
    const crane = facility.fleet[slot.rack]
    const placement = movement(storeLegs(slot, cargo.kg, crane.at, facility.trayAt), operating.cranes)
    const retrieval = movement(pickupLegs(slot, cargo.kg, home(slot.rack)), operating.cranes)
    const urgency = Math.min(1, .5 / Math.max(.5, days) + .18 * cargo.priority + .30 * (1 - operating.truck))
    const components = {
      placement: weights.placement * (.56 * placement.kwh / 1.8 + .44 * placement.metres / 105),
      retrieval: weights.retrieval * (.22 + 1.45 * urgency) * (.72 * retrieval.seconds / 90 + .28 * retrieval.kwh / 1.6),
      capacity: weights.capacity * demand.pressure * ((1 - urgency) * Math.max(0, (5 - slot.bay) / 4) +
        (slot.reefer && cargo.kind !== 'reefer' ? .7 : 0)),
      workload: weights.workload * crane.completed / Math.max(1, facility.metrics.moves),
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
  const cargo = data.incoming[state.cargoIndex]
  if (!cargo) return null
  const operating = conditions(state)
  const prediction = predict(bundle, data, cargo, state.clock, operating)
  const demand = forecast(bundle, data, state.clock, operating)
  return { prediction, forecast: demand,
    ...rankings(data, state.floor, cargo, operating, prediction.days, demand) }
}

export function conditions(state: State): Operating {
  const physical = (state.floor.inventory.length + state.baseline.inventory.length) / 2 / state.capacity
  return { ...state.operation, occupancy: Math.min(1, Math.max(.05, physical + state.operation.occupancy - .65)) }
}

export function makePlacement(facility: Facility, cargo: Cargo, slot: Slot): Plan {
  return { kind: 'placement', cargo, target: slot, source: null,
    legs: storeLegs(slot, cargo.kg, facility.fleet[slot.rack].at, facility.trayAt) }
}

export function makePickup(data: DemoData, facility: Facility, item: Stored, context: Operating): Plan | null {
  const slot = data.cells.find((cell) => cell.id === item.slot)
  if (!slot || slot.blocked || !craneOnline(slot.rack, context)) return null
  return { kind: 'pickup', target: slot, source: slot.id, cargo: item.cargo,
    legs: pickupLegs(slot, item.cargo.kg, facility.fleet[slot.rack].at, facility.trayAt) }
}

export function apply(facility: Facility, plan: Plan, context: Operating, clock: number, days: number, actualDwell: number, requestedAt = clock): Facility {
  const bySlot = occupied(facility)
  const here = plan.source === null ? undefined : bySlot.get(plan.source)
  const rack = plan.target.rack
  if ((plan.kind !== 'placement' && here?.cargo.id !== plan.cargo.id) ||
      (plan.kind === 'placement' && facility.inventory.some((item) => item.cargo.id === plan.cargo.id)) ||
      !craneOnline(rack, context) || plan.target.blocked ||
      (plan.kind !== 'pickup' && (bySlot.has(plan.target.id) || restriction(plan.cargo, plan.target, context))) ||
      (plan.kind === 'relocation' && plan.source?.[0] !== rack)) {
    throw Error('The move is no longer valid for the current facility state.')
  }
  const measured = movement(plan.legs, context.cranes)
  const inventory = facility.inventory.filter((item) => item !== here)
  if (plan.kind === 'placement') inventory.push({
    cargo: plan.cargo, slot: plan.target.id, arrived: clock, ready: clock + actualDwell * DAY, days,
  })
  if (plan.kind === 'relocation' && here) inventory.push({ ...here, slot: plan.target.id })
  const lastCrane = plan.legs.findLast((leg) => leg.equipment === 'crane')
  const lastTray = plan.legs.findLast((leg) => leg.equipment === 'tray')
  const previous = facility.metrics
  return {
    inventory, moved: plan.kind === 'relocation' ? [...facility.moved, plan.cargo.id] : facility.moved,
    trayAt: lastTray?.to ?? facility.trayAt,
    fleet: { ...facility.fleet, [rack]: { at: lastCrane?.to ?? facility.fleet[rack].at, completed: facility.fleet[rack].completed + 1 } },
    metrics: { seconds: previous.seconds + measured.seconds, metres: previous.metres + measured.metres,
      kwh: previous.kwh + measured.kwh, moves: previous.moves + 1,
      placements: previous.placements + Number(plan.kind === 'placement'),
      pickups: previous.pickups + Number(plan.kind === 'pickup'),
      onTime: previous.onTime + Number(plan.kind === 'pickup' && measured.seconds + Math.max(0, clock - requestedAt) / 1000 <= 60),
      retrievalSeconds: previous.retrievalSeconds + (plan.kind === 'pickup' ? measured.seconds : 0),
      relocations: previous.relocations + Number(plan.kind === 'relocation') },
  }
}

export function elapsedIdle(facility: Facility, seconds: number, activeCranes: number): Facility {
  return { ...facility, metrics: { ...facility.metrics, kwh: facility.metrics.kwh +
    physics.idleKw * activeCranes * Math.max(0, seconds) / 3600 } }
}

export function partialPlacement(state: State, data: DemoData, choice: Ranking) {
  const decision = state.decision
  const cargo = data.incoming[state.cargoIndex]
  if (!decision || !cargo || state.step !== 'predicted') throw Error('Run a prediction before placing cargo.')
  const plan = makePlacement(state.floor, cargo, choice.slot)
  const operating = conditions(state)
  const actualDwell = 2 + (state.cargoIndex * 37 % 67) / 10
  const floor = apply(state.floor, plan, operating, state.clock, decision.prediction.days, actualDwell)
  const conventional = pickPolicy(rankings(data, state.baseline, cargo, operating, decision.prediction.days,
    decision.forecast).choices, 'first', decision.prediction.days)
  const baselinePlan = conventional ? makePlacement(state.baseline, cargo, conventional.slot) : null
  const baseFloor = baselinePlan ? apply(state.baseline, baselinePlan, operating, state.clock, decision.prediction.days, actualDwell) : state.baseline
  const time = movement(plan.legs, operating.cranes).seconds
  const baseTime = baselinePlan ? movement(baselinePlan.legs, operating.cranes).seconds : 0
  const wall = Math.max(time, baseTime)
  return { plan, next: { ...state, floor: elapsedIdle(floor, wall-time, operating.cranes),
    baseline: elapsedIdle(baseFloor, wall-baseTime, operating.cranes),
    clock: state.clock + Math.round(wall * 1000), step: 'placed' as const,
    advice: null, notice: baselinePlan ? '' : 'First-available policy could not place this container.' } }
}

export function opportunities(state: State, data: DemoData, bundle: Bundle): Opportunity[] {
  const { floor, clock, rates } = state
  const operating = conditions(state)
  const demand = forecast(bundle, data, clock, operating)
  const slots = occupied(floor)
  const best: Opportunity[] = []
  for (const stored of floor.inventory) {
    if (floor.moved.includes(stored.cargo.id)) continue
    const { cargo, arrived } = stored
    const source = data.cells.find((cell) => cell.id === stored.slot)
    if (!source || source.blocked || !craneOnline(source.rack, operating)) continue
    const days = infer(bundle.models.dwell, dwellFeatures(cargo, dubaiDate(arrived), operating, data))
    const spread = bundle.models.dwell.radius ?? 1.2
    const minimum = Math.max(.25, days - spread, (clock - arrived) / DAY)
    const maximum = Math.max(minimum + .75, days + spread)
    const low = minimum - (clock - arrived) / DAY
    const high = maximum - (clock - arrived) / DAY
    const remaining = (low + high) / 2
    const probability = Math.max(0, Math.min(1, (assumptions.horizonDays - low) / (high - low)))
    if (probability === 0) continue
    const current = movement(pickupLegs(source, cargo.kg, home(source.rack)), operating.cranes)
    for (const target of data.cells) {
      if (target.rack !== source.rack || slots.has(target.id) || restriction(cargo, target, operating)) continue
      const proposed = movement(pickupLegs(target, cargo.kg, home(target.rack)), operating.cranes)
      if (proposed.seconds >= current.seconds) continue
      const legs = relocationLegs(source, target, cargo.kg, floor.fleet[target.rack].at)
      const move = movement(legs, operating.cranes)
      const idleRate = { ...rates, time: rates.time * assumptions.earlyStagingTimeFactor }
      const servicePressure = 1 + demand.pressure + operating.congestion
      const serviceValue = (current.seconds - proposed.seconds) * rates.time / 3600 * (servicePressure - 1)
      const benefit = probability * (cost(current, rates) - cost(proposed, rates) + serviceValue) - cost(move, idleRate)
      if (benefit < assumptions.minimumBenefitAED) continue
      best.push({ plan: { kind: 'relocation', cargo, source: source.id, target, legs },
        current, proposed, move, remaining, probability, benefit, demand })
    }
  }
  return best.sort((a,b) => b.benefit-a.benefit || a.plan.cargo.id.localeCompare(b.plan.cargo.id) ||
    a.plan.target.id.localeCompare(b.plan.target.id)).slice(0, 3)
}

export function completeRelocation(state: State, opportunity: Opportunity): State {
  const time = movement(opportunity.plan.legs, state.operation.cranes).seconds
  return { ...state, clock: state.clock + Math.round(time * 1000),
    floor: apply(state.floor, opportunity.plan, state.operation, state.clock, 0, 0),
    baseline: elapsedIdle(state.baseline, time, state.operation.cranes),
    notice: `${opportunity.plan.cargo.id} positioned in ${opportunity.plan.target.id}.`, lastRelocation: opportunity, advice: null }
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
    step: state.step === 'predicted' ? 'arrived' as const : state.step, override: undefined, advice: null, notice: '' }
}

export function projectedRetrieval(data: DemoData, facility: Facility, operating: Operating) {
  const available = facility.inventory.flatMap((item) => {
    const slot = data.cells.find((cell) => cell.id === item.slot)
    return slot && !slot.blocked && craneOnline(slot.rack, operating)
      ? [movement(pickupLegs(slot, item.cargo.kg, home(slot.rack)), operating.cranes).seconds] : []
  })
  return available.length ? available.reduce((sum, seconds) => sum + seconds, 0) / available.length : null
}
