import type { Cargo, DemoData, Operating } from '../simulation/types'

export const DAY = 86_400_000
const HOUR = 3_600_000
export const MODEL_VERSION = 'jebel-ali-2022-26-v1'
const modelNames = ['dwell', 'arrivals', 'pickups', 'week'] as const
type ModelName = typeof modelNames[number]
type Leaf = { nodeid: number; leaf: number }
type Split = {
  nodeid: number
  split: string
  split_condition: number
  yes: number
  no: number
  missing: number
  children: Tree[]
}
type Tree = Leaf | Split
type Model = { name: string; trees: Tree[]; features: string[]; baselines: number[]; radius: number | null }
export type Bundle = { schema: 1; version: string; models: Record<ModelName, Model> }

export type Prediction = {
  days: number
  low: number | null
  high: number | null
  pickup: number
  category: 'Fast' | 'Medium' | 'Long'
  event: string
  sensitivity: { feature: string; days: number; input: number; reference: number }[]
  durationMs: number
  version: string
}
export type Forecast = { arrivals: number; pickups: number; week: number; pressure: number }

export const dubaiDate = (timestamp: number) => new Date(timestamp + 4 * HOUR).toISOString().slice(0, 10)
export const dubaiTime = (day: string) => Date.parse(day + 'T08:00:00+04:00')
export const formatDubai = (timestamp: number) => new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Dubai', dateStyle: 'medium', timeStyle: 'short',
}).format(timestamp) + ' GST'
export const category = (days: number): Prediction['category'] => days < 3 ? 'Fast' : days < 6 ? 'Medium' : 'Long'

export function season(day: string, data: DemoData) {
  const active = data.events.flatMap((event) => {
    const gap = Math.round((Date.parse(day) - Date.parse(event.date)) / DAY)
    if (gap < -event.before || gap >= event.duration + event.after) return []
    return [{ kind: event.kind, gap, broad: Number([1, 4, 8, 10].includes(event.kind)),
      distance: Math.max(0, -gap, gap - event.duration + 1) }]
  }).sort((a, b) => a.broad - b.broad || a.distance - b.distance || Math.abs(a.gap) - Math.abs(b.gap) || a.kind - b.kind)
  const winner = active[0]
  return winner ? [winner.kind, Math.min(31, Math.max(0, -winner.gap)), Math.min(31, Math.max(0, winner.gap))] : [0, 31, 31]
}

function calendarInputs(day: string, data: DemoData) {
  const date = new Date(day + 'T00:00:00Z')
  return [date.getUTCMonth() + 1, (date.getUTCDay() + 6) % 7, ...season(day, data)]
}

export function dwellFeatures(cargo: Cargo, day: string, operating: Operating, data: DemoData) {
  const known = cargo.receiver >= 0 && cargo.receiver < 10
  const receiver = known ? data.receivers[cargo.receiver] : undefined
  const calendar = calendarInputs(day, data)
  return [receiver?.dwell ?? 4.6, receiver?.reliability ?? .77, known ? cargo.receiver : -1,
    cargo.commodity, cargo.lane, cargo.size, cargo.kg / 1000, { dry: 0, reefer: 1, hazard: 2 }[cargo.kind],
    cargo.priority, cargo.customs, ...calendar, operating.vessel + ([4, 5, 6, 10].includes(calendar[2]) ? .24 : 0),
    operating.occupancy, operating.truck, operating.vessel, operating.cranes / 2, operating.congestion]
}

export function infer(model: Model, features: (number | null)[]) {
  return Math.max(.25, model.trees.reduce((prediction, tree) => {
    let node = tree
    while (!('leaf' in node)) {
      const value = features[Number(node.split.slice(1))]
      const target = value == null ? node.missing : Math.fround(value) < Math.fround(node.split_condition) ? node.yes : node.no
      const child = node.children.find((branch) => branch.nodeid === target)
      if (!child) throw Error('The model contains an invalid decision tree.')
      node = child
    }
    return prediction + node.leaf
  }, 0))
}

export function sensitivity(model: Model, vector: (number | null)[], value: number) {
  return model.features.map((feature, i) => {
    const changed = vector.slice()
    changed[i] = model.baselines[i]
    return { feature, days: value - infer(model, changed), input: vector[i] ?? NaN, reference: changed[i] ?? NaN }
  })
}

export function predict(bundle: Bundle, data: DemoData, cargo: Cargo, clock: number, operating: Operating): Prediction {
  const start = performance.now()
  const vector = dwellFeatures(cargo, dubaiDate(clock), operating, data)
  const model = bundle.models.dwell
  const days = infer(model, vector)
  const radius = model.radius
  const factors = sensitivity(model, vector, days).sort((a, b) => Math.abs(b.days) - Math.abs(a.days))
  return { days, pickup: clock + days * DAY, category: category(days), event: data.eventNames[vector[12]],
    low: radius === null ? null : Math.max(0, days - radius), high: radius === null ? null : days + radius,
    sensitivity: factors, version: bundle.version, durationMs: performance.now() - start }
}

export function forecast(bundle: Bundle, data: DemoData, clock: number, context: Operating): Forecast {
  const values = [...calendarInputs(dubaiDate(clock), data), context.vessel, context.occupancy,
    context.congestion, context.truck, context.cranes / 2]
  const arrivals = infer(bundle.models.arrivals, values)
  const pickups = infer(bundle.models.pickups, values)
  const week = infer(bundle.models.week, values)
  return { arrivals, pickups, week, pressure: Math.min(1, (.55 * arrivals + .45 * week / 7) / (data.cells.length * .55)) }
}

function validTree(value: unknown, features: number, depth = 0): value is Tree {
  if (!value || typeof value !== 'object' || depth > 32 || !('nodeid' in value) || !Number.isInteger(value.nodeid)) return false
  if ('leaf' in value) return Number.isFinite(value.leaf)
  const t = value as Split
  if (typeof t.split !== 'string' || !/^f\d+$/.test(t.split) || Number(t.split.slice(1)) >= features ||
      !Number.isFinite(t.split_condition) || !Array.isArray(t.children) || t.children.length !== 2) return false
  return t.yes !== t.no && [t.yes, t.no, t.missing].every((id) =>
    Number.isInteger(id) && t.children.some((child) => child?.nodeid === id)) &&
    t.children.every((child) => validTree(child, features, depth + 1))
}

export function isBundle(value: unknown): value is Bundle {
  const candidate = value as Bundle | null
  return candidate?.schema === 1 && candidate.version === MODEL_VERSION && modelNames.every((name) => {
    const model = candidate.models?.[name]
    const length = name === 'dwell' ? 21 : 10
    return model?.name === name && Array.isArray(model.features) && model.features.length === length &&
      model.features.every((feature) => typeof feature === 'string') && Array.isArray(model.baselines) &&
      model.baselines.length === length && model.baselines.every(Number.isFinite) &&
      (model.radius === null || Number.isFinite(model.radius) && model.radius > 0) &&
      Array.isArray(model.trees) && model.trees.length > 0 && model.trees.every((tree) => validTree(tree, length))
  })
}

let pending: Promise<{ data: DemoData; bundle: Bundle }> | undefined
export function loadAssets() {
  pending ??= Promise.all(['demo-data/jebel-ali.json', `models/${MODEL_VERSION}.json`].map(async (file) => {
    const result = await fetch(import.meta.env.BASE_URL + file)
    if (!result.ok) throw Error(`Required asset unavailable: ${file}`)
    try {
      return await result.json() as unknown
    } catch {
      throw Error(`Required asset is invalid: ${file}`)
    }
  })).then(([input, bundle]) => {
    const data = input as DemoData
    if (!data || data.schema !== 1 || !data.incoming?.length || !data.cells?.length || !data.scenarios?.length)
      throw Error('The Jebel Ali sample data is invalid.')
    if (!isBundle(bundle)) throw Error('The trained model artifact is missing or incompatible.')
    return { data, bundle }
  }).catch((error: unknown) => {
    pending = undefined
    throw error
  })
  return pending
}
