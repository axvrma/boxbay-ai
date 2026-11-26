import { DAY, dubaiDate, dwellFeatures, forecast, infer } from '../intelligence/inference'
import type { Bundle } from '../intelligence/inference'
import { apply, elapsedIdle, initialize, makePickup, makePlacement, pickPolicy, rankings, restriction } from './engine'
import type { Policy } from './engine'
import { cost, movement } from './physics'
import type { DemoData, Operating } from './types'

export const policyNames: Record<Policy,string> = {
  first: 'First available', nearest: 'Nearest feasible', tier: 'Fixed tier', ai: 'Predictive placement',
}
export const benchmarkConditions = ['normal','seasonal','full','surge','breakdown','trucks','reduced','delayed'] as const
export type Condition = typeof benchmarkConditions[number]

export function workload(seed: number, data: DemoData) {
  let state = seed >>> 0
  const random = () => {
    state = (Math.imul(1664525,state)+1013904223) >>> 0
    return state / 2 ** 32
  }
  return data.incoming.map((cargo) => ({ cargo, order: random(), stays: 1 + Math.floor(random() * 5) }))
    .sort((a,b) => a.order-b.order).slice(0,18)
    .map((item,i) => ({ ...item, arrival: Math.floor(i/3), pickup: Math.floor(i/3) + item.stays }))
}

export function simulate(data: DemoData, bundle: Bundle, condition: Condition, policy: Policy, seed: number) {
  const date = condition === 'seasonal' ? data.defaultDate : '2026-05-12'
  const occupied = new Set(data.initial.map((item) => item.slot))
  const dense = condition === 'full'
    ? data.cells.filter((slot) => !occupied.has(slot.id)).flatMap((slot, i) => {
      const compatible = data.incoming.find((cargo) => !restriction(cargo, slot, data.scenarios[0]))
      return compatible ? [{ cargo: { ...compatible, id: `JA-DENSE-${i}` }, slot: slot.id,
        ageDays: .5, actualDwellDays: 8 + i % 5 }] : []
    }).slice(0, 12) : []
  const base = initialize({ ...data, initial: [...data.initial, ...dense] },bundle,date)
  const id = condition === 'seasonal' ? 'normal' : condition
  const operating = data.scenarios.find((item) => item.id === id)!
  let floor = base.floor
  let rejected = 0
  const arrivals = workload(seed,data)
  const requested = new Map<string, number>()
  const completed = new Set<string>()
  const windowSeconds = 1200
  const rates = base.rates
  for (let day=0; day<12; day++) {
    const clock = base.clock + day * DAY
    const daily: Operating = { ...operating, occupancy: Math.min(.97, operating.occupancy + arrivals.filter((item) => item.arrival === day).length / 100) }
    const startUsage = floor.metrics.seconds
    const expected = forecast(bundle,data,clock,daily)
    for (const item of arrivals.filter((work) => work.pickup === day)) requested.set(item.cargo.id, clock)
    for (const initial of base.floor.inventory.filter((item) => item.ready <= clock && !requested.has(item.cargo.id))) {
      requested.set(initial.cargo.id, clock)
    }
    for (const item of floor.inventory.filter((stored) => requested.has(stored.cargo.id) && !completed.has(stored.cargo.id))) {
      const plan = makePickup(data.cells,floor,item,daily)
      if (plan && floor.metrics.seconds - startUsage + movement(plan.legs, daily.cranes).seconds <= windowSeconds) {
        floor = apply(floor,plan,daily,clock + (floor.metrics.seconds-startUsage)*1000,item.days,0,requested.get(item.cargo.id))
        completed.add(item.cargo.id)
      }
    }
    for (const entry of arrivals.filter((item) => item.arrival === day)) {
      const days = infer(bundle.models.dwell,dwellFeatures(entry.cargo,dubaiDate(clock),daily,data))
      const ranking = rankings(data.cells,floor,entry.cargo,daily,days,expected)
      const selected = pickPolicy(ranking.choices,policy,days)
      if (selected && floor.metrics.seconds - startUsage + selected.placement.seconds <= windowSeconds) {
        floor = apply(floor,makePlacement(floor,entry.cargo,selected.slot),daily,clock,days,entry.stays)
      } else rejected++
    }
    floor = elapsedIdle(floor,windowSeconds-(floor.metrics.seconds-startUsage),daily.cranes)
  }
  const metrics = floor.metrics
  return {
    condition, policy, seed, kwh: metrics.kwh, cost: cost(metrics, rates),
    retrieval: metrics.pickups > 0 ? metrics.retrievalSeconds/metrics.pickups : null,
    moves: metrics.moves, sla: requested.size > 0 ? metrics.onTime/requested.size : 0,
    complete: metrics.pickups, requests: requested.size, rejected, unserved: requested.size-metrics.pickups,
  }
}
