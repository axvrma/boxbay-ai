import type { Decision } from './model'

type Option = Decision['selected']

const factorLabels = {
  energy: 'Energy for this move',
  retrieval: 'Estimated later pickup travel',
  nearInterface: 'Keeping space near the interface open',
  powered: 'Keeping powered slots open',
} as const

function costBreakdown(option: Option) {
  const { seconds, cost, placement_factors } = option
  if (typeof seconds !== 'number' || typeof cost !== 'number' || !placement_factors ||
    typeof placement_factors !== 'object') return
  const { retrieval_cost, near_interface_cost, powered_slot_cost } = placement_factors as Record<string, unknown>
  if (typeof retrieval_cost !== 'number' || typeof near_interface_cost !== 'number' ||
    typeof powered_slot_cost !== 'number') return
  // The recorded predictive score is move time plus weighted energy and future costs.
  return {
    seconds, cost,
    energy: cost - seconds - retrieval_cost - near_interface_cost - powered_slot_cost,
    retrieval: retrieval_cost, nearInterface: near_interface_cost, powered: powered_slot_cost,
  }
}

export function comparePlacement(decision: Decision, option: Option) {
  const selected = costBreakdown(decision.selected)
  const alternative = costBreakdown(option)
  if (!selected || !alternative) return
  const factors = (Object.keys(factorLabels) as (keyof typeof factorLabels)[]).map((key) => ({
    key, label: factorLabels[key], selected: selected[key], alternative: alternative[key],
    advantage: alternative[key] - selected[key],
  }))
  const leading = factors.reduce((best, factor) => factor.advantage > best.advantage ? factor : best)
  return {
    factors, timeDifference: selected.seconds - alternative.seconds, scoreAdvantage: alternative.cost - selected.cost,
    leadingFactor: leading.advantage > 0 ? leading : undefined,
  }
}

export function placementAlternatives(decision: Decision) {
  if (decision.action !== 'store' || decision.override) return []
  const ranked = decision.alternatives.filter((option) => comparePlacement(decision, option))
  const faster = ranked.filter((option) => Number(option.seconds) < Number(decision.selected.seconds))
    .sort((a, b) => Number(a.seconds) - Number(b.seconds))
  const contrasting = faster.find((option) => Number(option.cost) > Number(decision.selected.cost))
  return contrasting ? [contrasting, ...ranked.filter((option) => option !== contrasting)] : ranked
}
