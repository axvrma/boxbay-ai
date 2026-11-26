import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import { category, dubaiDate, dubaiTime, dwellFeatures, infer, isBundle, MODEL_VERSION, predict, season, sensitivity } from '../apps/web/src/intelligence/inference'
import { apply, changeConditions, conditions, evaluate, initialize, makePickup, occupied,
  partialPlacement, placementRestriction, rankings, restriction } from '../apps/web/src/simulation/engine'
import { simulate, workload } from '../apps/web/src/simulation/experiment'
import { containerLength, cost, handoff, inbound, movement, outbound, physics, point, sampleHandling } from '../apps/web/src/simulation/physics'
import { createSession } from '../apps/web/src/simulation/session'
import type { Bundle } from '../apps/web/src/intelligence/inference'
import type { Cargo, DemoData, Operating } from '../apps/web/src/simulation/types'
import fixture from './model-parity.json'

const read = (file: string) => readFileSync(new URL('../apps/web/public/' + file, import.meta.url), 'utf8')
const data = JSON.parse(read('demo-data/jebel-ali.json')) as DemoData
const model: unknown = JSON.parse(read(`models/${MODEL_VERSION}.json`))
if (!isBundle(model)) throw Error('The production model must be valid.')
const bundle: Bundle = model

describe('real models', () => {
  test('matches exported XGBoost predictions, missing branches and sensitivity', () => {
    expect(fixture.version).toBe(bundle.version)
    for (const [name, vectors] of Object.entries(fixture.vectors)) {
      const current = bundle.models[name as keyof Bundle['models']]
      for (const row of vectors) {
        const value = infer(current, row.features)
        expect(Math.abs(value - row.value)).toBeLessThan(.0001)
        const values = sensitivity(current, row.features, value)
        values.forEach((factor, index) => expect(Math.abs(factor.days - row.sensitivities[index])).toBeLessThan(.00015))
      }
    }
  })

  test('uses matching calendar, feature ordering and unknown receivers', () => {
    for (const row of fixture.raw) {
      const features = dwellFeatures(row.cargo as Cargo, row.date, row.context as Operating, data)
      expect(features).toEqual(row.features)
      expect(infer(bundle.models.dwell, features)).toBeCloseTo(row.value, 6)
    }
    expect(season('2025-03-13', data)[0]).toBe(1)
    expect(season('2025-12-19', data)[0]).toBe(6)
    expect(dubaiDate(Date.parse('2025-03-12T21:00:00Z'))).toBe('2025-03-13')
    expect(new Date(dubaiTime('2025-03-12')).toISOString()).toBe('2025-03-12T04:00:00.000Z')
    const cold = { ...data.incoming[0], receiver: 122 }
    expect(dwellFeatures(cold,'2025-03-13',data.scenarios[0],data).slice(0,3)).toEqual([4.6,.77,-1])
    const initial = initialize(data,bundle)
    const fresh = evaluate(changeConditions(initial,initial.operation,'2025-03-13'),data,bundle)!
    expect(Math.abs(evaluate(initial,data,bundle)!.prediction.days - fresh.prediction.days)).toBeGreaterThan(.2)
    expect(predict(bundle,data,cold,initial.clock,initial.operation).days).toBeGreaterThan(0)
  })

  test('publishes model and dataset evidence with matching digests', () => {
    const evaluation = JSON.parse(read('evidence/model-evaluation.json'))
    const dataset = JSON.parse(read('evidence/dataset.json'))
    expect(evaluation.generatedFrom).toEqual(dataset.manifest.sha256)
    expect(evaluation.artifactSha256).toEqual(createHash('sha256').update(read(`models/${MODEL_VERSION}.json`)).digest('hex'))
  })

  test('rejects missing or malformed artifacts without fallback predictions', () => {
    expect(isBundle(null)).toBe(false)
    expect(isBundle({ ...bundle, version: 'unknown' })).toBe(false)
    const updated = structuredClone(bundle)
    updated.models.dwell.trees[0].nodeid = NaN
    expect(isBundle(updated)).toBe(false)
  })
})

describe('simulation', () => {
  test('starts from a valid synthetic 64-cell facility and contains only input fixtures', () => {
    expect(data.cells).toHaveLength(64)
    expect(data.initial).toHaveLength(45)
    expect(data.incoming.length).toBeGreaterThanOrEqual(30)
    expect(data.receivers).toHaveLength(12)
    expect(new Set(initialize(data,bundle).floor.inventory.map((item) => category(item.days))).size).toBe(3)
    const slots = new Map(data.cells.map((cell) => [cell.id,cell]))
    expect(new Set(data.initial.map((item)=>item.slot)).size).toBe(45)
    for (const item of data.initial) expect(restriction(item.cargo,slots.get(item.slot)!,data.scenarios[0])).toBeNull()
    expect(Object.keys(data).every((key) => !/replay|decision|metrics/i.test(key))).toBe(true)
  })

  test('filters restrictions and ranks the rest, including full and outage cases', () => {
    const state = initialize(data,bundle)
    const decision = evaluate(state,data,bundle)!
    expect(decision.choices.length).toBeGreaterThan(1)
    expect(decision.choices[0].score).toBeLessThanOrEqual(decision.choices[1].score)
    expect(decision.choices.every((r)=>restriction(data.incoming[0],r.slot,conditions(state))===null)).toBe(true)
    const down = { ...state, operation: data.scenarios.find((item)=>item.id==='breakdown')! }
    expect(evaluate(down,data,bundle)!.choices.every((item)=>item.slot.rack==='A')).toBe(true)
    const floor = { ...state.floor, inventory: data.cells.map((slot,i)=>({...state.floor.inventory[i%45],slot:slot.id})) }
    expect(rankings(data,floor,data.incoming[0],state.operation,3,decision.forecast).choices).toEqual([])
    const reefer = data.incoming[2]
    expect(restriction(reefer,data.cells.find((x)=>!x.blocked&&!x.reefer&&!x.hazard&&x.bay===4)!,state.operation)).toBe('Reefer power required')
  })

  test('validates equipment legs, commits placement metrics, and restores complete previous actions', () => {
    const initial = initialize(data,bundle)
    const session = createSession(initial)
    const decision = evaluate(initial,data,bundle)!
    const prior = { ...initial, step: 'predicted' as const, decision, override: decision.choices[1].slot.id }
    session.getState().commit(prior)
    const { plan,next } = partialPlacement(prior,data,decision.choices[1])
    session.getState().commit(next)
    expect(next.floor.inventory).toHaveLength(46)
    expect(next.floor.metrics.moves).toBe(1)
    expect(next.baseline.metrics.moves).toBe(1)
    expect(plan.legs.map((leg)=>leg.equipment)).toContain('tray')
    expect(movement(plan.legs).kwh).toBeGreaterThan(0)
    expect(() => apply(next.floor,plan,next.operation,next.clock,0,0)).toThrow('no longer valid')
    expect(changeConditions(next,next.operation,'2025-03-13')).toBe(next)
    const future = changeConditions(next,next.operation,'2026-02-21')
    expect(future.floor).toBe(next.floor)
    const rebased = changeConditions(prior,prior.operation,'2026-02-21')
    expect(rebased.decision).toBeNull()
    expect(rebased.floor.inventory.map((item)=>item.slot)).toEqual(prior.floor.inventory.map((item)=>item.slot))
    expect(rebased.clock - rebased.floor.inventory[0].arrived).toEqual(prior.clock - prior.floor.inventory[0].arrived)
    session.getState().previous()
    expect(session.getState().state).toEqual(prior)
    session.getState().previous()
    expect(session.getState().state).toEqual(initial)
  })

  test('honors a validated manual rack position and uses the priority in both inference and placement', () => {
    const initial = initialize(data,bundle)
    const slot = data.cells.find((item) => item.id === 'A01-1')!
    const standard = evaluate(initial,data,bundle)!
    expect(standard.choices.some((choice) => choice.slot.id === slot.id)).toBe(false)
    expect(placementRestriction(data.incoming[0], slot, conditions(initial), occupied(initial.floor))).toBe('Reserved for urgent cargo')
    const invalid = { ...initial, step: 'predicted' as const, decision: standard, override: slot.id }
    expect(() => partialPlacement(invalid,data,standard.choices[0])).toThrow('Choose a feasible storage position')
    const edited = { ...invalid, priorityOverride: 2 }
    const decision = evaluate(edited,data,bundle)!
    expect(decision.prediction.days).not.toBe(standard.prediction.days)
    const chosen = decision.choices.find((choice) => choice.slot.id === slot.id)!
    expect(chosen).toBeDefined()
    const { plan, next } = partialPlacement({ ...edited, decision }, data, chosen)
    expect(plan.cargo.priority).toBe(2)
    expect(occupied(next.floor).get(slot.id)?.cargo.priority).toBe(2)
    expect(data.incoming[0].priority).toBe(1)
  })

  test('keeps the pallet still during the lift and inserts the load sideways at the chosen height', () => {
    const initial = initialize(data,bundle)
    for (const rack of ['A','B']) {
      const decision = evaluate(initial,data,bundle)!
      const choice = decision.choices.find(({slot}) => slot.rack === rack)!
      const { plan, next } = partialPlacement({ ...initial, step: 'predicted', decision }, data, choice)
      const { legs, target } = plan
      const otherColumn = data.cells.find((slot) => slot.rack === rack && slot.bay === 2 && slot.level === 1)!
      const firstColumn = data.cells.find((slot) => slot.rack === rack && slot.bay === 1 && slot.level === 1)!
      expect(otherColumn.x - firstColumn.x).toBeGreaterThan(containerLength(40))
      expect(legs.map((leg) => leg.phase)).toEqual(['pallet','grip','lift','travel','extend','set-down','release','retract'])
      const middleOf = (index: number) => sampleHandling(legs,
        legs.slice(0,index).reduce((time, leg) => time + leg.seconds, 0) + legs[index].seconds / 2)
      const delivery = middleOf(0)
      expect(delivery.cargoAt).toEqual(delivery.palletAt)
      expect(sampleHandling(legs,0).cargoAt).toEqual(inbound)
      const grip = middleOf(1)
      expect(grip.cargoAt).toEqual(handoff)
      expect(grip.palletAt).toEqual(handoff)
      const lift = middleOf(2)
      expect(lift.palletAt).toEqual(handoff)
      expect(lift.cargoAt[1]).toBeGreaterThan(handoff[1])
      expect(lift.cargoAt[0]).toBe(handoff[0])
      const travel = middleOf(3)
      expect(travel.cargoAt[0]).toBeGreaterThan(handoff[0])
      expect(travel.cargoAt[1]).toBeGreaterThan(lift.cargoAt[1])
      expect(travel.cargoAt[2]).toBe(0)
      const insertion = middleOf(4)
      expect(insertion.cargoAt[0]).toBe(target.x)
      expect(insertion.cargoAt[1]).toBe(target.y + .18)
      expect(insertion.cargoAt[2]).toBeCloseTo(target.z / 2)
      expect(middleOf(7).cargoAt).toEqual(point(target))
      expect(next.floor.stacker.at).toEqual([target.x, target.y + .33, 0])
      const stored = occupied(next.floor).get(target.id)!
      const pickup = makePickup(data,next.floor,stored,next.operation)!
      const collected = sampleHandling(pickup.legs, movement(pickup.legs).seconds + 1)
      expect(collected.cargoAt).toEqual(outbound)
      expect(collected.palletAt).toEqual(outbound)
    }
  })

  test('uses documented units and matched deterministic workloads for baseline comparisons', () => {
    const metrics = { kwh: 2, metres: 1000, seconds: 3600 }
    expect(cost(metrics,data.rates)).toBeCloseTo(2*data.rates.electricity+data.rates.equipment+data.rates.time)
    expect(movement([],2).kwh).toBe(0)
    expect(physics.regeneration).toBeLessThan(1)
    expect(workload(81,data)).toEqual(workload(81,data))
    expect(workload(81,data)).not.toEqual(workload(82,data))
    const predictive = simulate(data,bundle,'normal','ai',81)
    const baseline = simulate(data,bundle,'normal','first',81)
    expect(predictive.requests).toBe(baseline.requests)
    expect(predictive).toEqual(simulate(data,bundle,'normal','ai',81))
    expect(predictive.moves).toBeGreaterThanOrEqual(predictive.complete)
  })
})
