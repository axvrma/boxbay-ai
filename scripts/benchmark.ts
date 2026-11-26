import { readFileSync, writeFileSync } from 'node:fs'
import { benchmarkConditions, policyNames, simulate } from '../apps/web/src/simulation/experiment'
import type { Policy } from '../apps/web/src/simulation/engine'
import { isBundle, MODEL_VERSION } from '../apps/web/src/intelligence/inference'
import type { DemoData } from '../apps/web/src/simulation/types'

const publicDir = new URL('../apps/web/public/', import.meta.url)
const data = JSON.parse(readFileSync(new URL('demo-data/jebel-ali.json', publicDir), 'utf-8')) as DemoData
const model: unknown = JSON.parse(readFileSync(new URL(`models/${MODEL_VERSION}.json`, publicDir), 'utf-8'))
if (!isBundle(model)) throw Error('The benchmark requires a valid trained model.')
const seeds = [21,35,70,81,112,144,183,204]
const policies = Object.keys(policyNames) as Policy[]
const start = performance.now()
const rows = benchmarkConditions.flatMap((condition) => seeds.flatMap((seed) =>
  policies.map((policy) => simulate(data, model, condition,policy,seed))))
const mean = (values: number[]) => values.reduce((sum, value) => sum+value,0)/values.length
const average = (source: typeof rows, field: keyof typeof rows[number]) => {
  const values = source.map((row) => row[field]).filter((value): value is number => typeof value === 'number')
  return values.length ? mean(values) : null
}
const summaries = benchmarkConditions.flatMap((condition) => {
  const baseline = rows.filter((row) => row.condition === condition && row.policy === 'first')
  return policies.map((policy) => {
    const runs = rows.filter((row) => row.condition === condition && row.policy === policy)
    const deltas = runs.map((row,i) => row.cost-baseline[i].cost)
    return { condition, policy, pairs: runs.length, kwh: average(runs,'kwh'), retrieval: average(runs,'retrieval'),
      cost: average(runs,'cost'), moves: average(runs,'moves'),
      sla: average(runs,'sla'), shipped: average(runs,'complete'), unserved: average(runs,'unserved'),
      rejected: average(runs,'rejected'), minCostDelta: Math.min(...deltas), maxCostDelta: Math.max(...deltas),
      adverseCostPairs: deltas.filter((delta) => delta > 1e-9).length }
  })
})
writeFileSync(new URL('evidence/simulation-benchmark.json',publicDir), JSON.stringify({
  version: MODEL_VERSION, seeds, conditions: benchmarkConditions, policies, summaries,
  method: 'Matched initial facility, independent arrival queue and actual pickup requests. Twelve simulated operating windows of 20 minutes.',
}, (_key, value: unknown) => typeof value === 'number' && !Number.isInteger(value) ? Number(value.toFixed(6)) : value, 2) + '\n')
console.log(`Simulated ${rows.length} matched runs in ${(performance.now()-start).toFixed(0)} ms`)
