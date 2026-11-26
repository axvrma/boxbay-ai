import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { Run } from './model'
import { buildFrame, trail, trayPosition } from './replay'
import { decisionTrace, guidedMoments, initialCursor, resolveCursor } from './decisionReplay'
import { comparePlacement, placementAlternatives } from './placementComparison'

const recorded = (name: string): Run => JSON.parse(readFileSync(new URL(`../public/evidence/replays/${name}.json`, import.meta.url), 'utf8'))

test('replay projects starting inventory and authoritative final metrics', () => {
  const run = recorded('surge-predictive')
  const start = buildFrame(run, 0)
  const end = buildFrame(run, run.scenario.horizon_s ?? 4800)
  assert.equal(start.occupancy.size, run.metrics.initial_inventory)
  assert.equal(end.occupancy.size, run.metrics.ending_inventory)
  assert.equal(end.moves, run.metrics.moves)
  assert.equal(end.pickups, run.metrics.pickups)
  assert.equal(end.energy, run.metrics.kwh)
  assert.equal(trail(run).at(-1)?.occupancy, run.metrics.ending_inventory)
})

test('an offline rack crane leaves its pickups in storage', () => {
  const run = recorded('breakdown-predictive')
  const wait = run.events.find((event) => event.kind === 'PICKUP_WAITING_FOR_RACK_CRANE')
  assert.ok(wait?.crane && wait.slot && wait.task)
  const frame = buildFrame(run, wait.t, wait.version)
  assert.equal(frame.cranes[wait.crane].state, 'failed')
  assert.equal(frame.occupancy.get(wait.slot), wait.container)
  const later = run.decisions.find((decision) => decision.task === wait.task && decision.state_version >= wait.version)
  assert.ok(later)
  assert.equal(later.selected.crane, wait.crane)
  assert.equal(later.selected.slot, wait.slot)
  assert.equal(decisionTrace(run, later).result?.kind, 'HANDLING_TASK_COMPLETED')
})

test('playback is order independent', () => {
  const run = recorded('override-predictive')
  const first = buildFrame(run, 180)
  buildFrame(run, 900)
  assert.deepEqual(buildFrame(run, 180), first)
  assert.ok(run.decisions.some((d) => d.override?.feasible))
})

test('decision, reservation, and dispatch are separately inspectable at the same second', () => {
  const run = recorded('surge-predictive')
  const reset = resolveCursor(run, { event: 0 })
  assert.equal(reset.version, 0)
  assert.equal(buildFrame(run, reset.time, reset.version).forecast, undefined)
  assert.ok(buildFrame(run, 0).forecast)
  const opening = resolveCursor(run, initialCursor(run))
  const decision = opening.decision
  assert.ok(decision)
  assert.equal(decision.action, 'store')
  const slot = String(decision.selected.slot)
  const crane = String(decision.selected.crane)
  const before = buildFrame(run, opening.time, opening.version)
  assert.equal(before.reserved.has(slot), false)
  assert.equal(before.cranes[crane].motion, undefined)

  const reservation = resolveCursor(run, { event: opening.version + 1 })
  assert.equal(reservation.time, opening.time)
  const reserved = buildFrame(run, reservation.time, reservation.version)
  assert.equal(reserved.reserved.get(slot), decision.container)
  assert.equal(reserved.cranes[crane].motion, undefined)

  const dispatch = resolveCursor(run, { decision: decision.id, phase: 'dispatch' })
  assert.equal(dispatch.time, opening.time)
  const dispatched = buildFrame(run, dispatch.time, dispatch.version)
  assert.equal(dispatched.cranes[crane].motion, undefined)
  const tray = Object.values(dispatched.trays).find((item) => item.container === decision.container)
  assert.ok(tray?.path)
  assert.deepEqual(trayPosition(tray, dispatch.time), tray.path[0])
  assert.deepEqual(trayPosition(tray, tray.finish), tray.path.at(-1))

  const handoff = resolveCursor(run, { decision: decision.id, phase: 'handoff' })
  const lifted = buildFrame(run, handoff.time, handoff.version)
  assert.ok(handoff.time > dispatch.time)
  assert.equal(lifted.cranes[crane].motion?.event.task, decision.task)
  assert.equal(lifted.trays[tray.id].container, undefined)
  assert.equal(buildFrame(run, opening.time, opening.version).reserved.has(slot), false)

  const result = resolveCursor(run, { decision: decision.id, phase: 'result' })
  assert.equal(result.decision?.id, decision.id)
  assert.equal(buildFrame(run, result.time, result.version).occupancy.get(slot), decision.container)
})

test('an interrupted inbound assignment returns on its tray before another rack serves it', () => {
  const run = recorded('breakdown-predictive')
  const original = run.decisions.find((decision) => decisionTrace(run, decision).result?.kind === 'HANDLING_TASK_CANCELLED')
  assert.ok(original)
  const interrupted = decisionTrace(run, original).result
  assert.ok(interrupted)
  const returned = run.events.find((event) => event.kind === 'TRAY_MOVE_COMPLETED' && event.data?.decision === original.id &&
    event.data.direction === 'to_interface')
  assert.ok(returned?.data?.loaded)
  const next = run.decisions.find((decision) => decision.task === original.task && decision.state_version >= returned.version)
  assert.ok(next)
  assert.notEqual(next.selected.crane, original.selected.crane)
  assert.notEqual(String(next.selected.slot).split(':')[0], String(original.selected.slot).split(':')[0])
  assert.equal(resolveCursor(run, { event: interrupted.version }).decision?.id, original.id)
})

test('five recorded scenarios open on a decision and keep their highlights addressable', () => {
  for (const name of ['surge', 'unexpected', 'breakdown', 'override', 'energy']) {
    const run = recorded(`${name}-predictive`)
    assert.ok(resolveCursor(run, initialCursor(run)).decision)
    for (const { cursor } of guidedMoments(run)) assert.ok(resolveCursor(run, cursor).version > 0)
  }
})

test('the same-decision comparison exposes the recorded trade-off without inventing scores', () => {
  const run = recorded('surge-predictive')
  const moment = guidedMoments(run).find(({ label }) => label === 'Keep a closer slot open')
  assert.ok(moment)
  const { decision } = resolveCursor(run, moment.cursor)
  assert.ok(decision)
  const [alternative] = placementAlternatives(decision)
  assert.equal(decision.selected.slot, 'R1:2:3:1')
  assert.equal(alternative.slot, 'R1:1:5:1')
  const comparison = comparePlacement(decision, alternative)
  assert.ok(comparison)
  assert.equal(comparison.timeDifference, 4)
  assert.equal(comparison.scoreAdvantage, 22)
  assert.equal(comparison.leadingFactor?.key, 'nearInterface')
  assert.equal(comparison.factors.reduce((sum, item) => sum + item.advantage, 0) - comparison.timeDifference, comparison.scoreAdvantage)
  assert.equal(comparePlacement(decision, { ...alternative, placement_factors: undefined }), undefined)

  const batch = run.decisions.find((item) => item.container === 'BX-0049')
  assert.ok(batch)
  assert.ok((comparePlacement(batch, batch.alternatives[0])?.scoreAdvantage ?? 0) < 0)
})
