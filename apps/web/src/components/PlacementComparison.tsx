import { useState } from 'react'
import { MapPin } from 'lucide-react'
import { fmt } from '../model'
import type { Decision } from '../model'
import { comparePlacement } from '../placementComparison'

type Props = {
  decision: Decision
  alternatives: Decision['alternatives']
  inspect: (slotId: string) => void
}

export default function PlacementComparison({ decision, alternatives, inspect }: Props) {
  const [slot, setSlot] = useState('')
  const option = alternatives.find((item) => item.slot === slot) ?? alternatives[0]
  const comparison = option && comparePlacement(decision, option)
  if (!comparison) return null
  const { timeDifference, scoreAdvantage, leadingFactor, factors } = comparison
  const timing = timeDifference === 0 ? 'Both slots had the same estimated move time.'
    : `The selected move was estimated to take ${fmt(Math.abs(timeDifference))} s ${timeDifference > 0 ? 'longer' : 'less'}.`
  const strongest = leadingFactor && leadingFactor.advantage > -timeDifference ? leadingFactor.label : 'Move time'
  const explanation = scoreAdvantage === 0 ? 'The two options had the same placement score.'
    : scoreAdvantage < 0 ? 'The alternative scored better for this move alone. Dispatch also considers other ready work and shared equipment.'
      : `${strongest} made the largest contribution to the selected slot’s lower score.`

  return <section className="decision-section placement-comparison" aria-label="Slot comparison at the decision">
    <div className="placement-comparison-heading">
      <h3>Why this slot over another?</h3>
      {alternatives.length > 1 && <select aria-label="Compare with another slot" value={String(option.slot)}
        onChange={(event) => setSlot(event.target.value)}>
        {alternatives.map((item) => <option key={String(item.slot)} value={String(item.slot)}>{String(item.slot)}</option>)}
      </select>}
    </div>
    <div className="placement-options">
      {[decision.selected, option].map((item, index) => <button type="button" key={String(item.slot)}
        className="placement-option" onClick={() => inspect(String(item.slot))}
        aria-label={`Show ${index === 0 ? 'selected slot' : 'alternative slot'} ${String(item.slot)} in facility`}>
        <span><MapPin size={14}/>{index === 0 ? 'AI chose' : 'Considered'}</span>
        <strong>{String(item.slot)}</strong>
        <small>{fmt(Number(item.seconds))} s · {fmt(Number(item.kwh), 2)} kWh</small>
      </button>)}
    </div>
    <p>{timing} {explanation}</p>
    <details className="placement-score">
      <summary>How the AI scored these slots</summary>
      <p>Lower scores are preferred for a move. The planner combines move time with weighted estimates for energy, later pickup and the value of keeping slots open.</p>
      <table className="placement-score-values">
        <thead><tr><th scope="col">Score contribution</th><th scope="col">AI chose</th><th scope="col">Considered</th></tr></thead>
        <tbody>
          <tr><th scope="row">Move time</th><td>{fmt(Number(decision.selected.seconds))}</td><td>{fmt(Number(option.seconds))}</td></tr>
          {factors.map((factor) => <tr key={factor.key}><th scope="row">{factor.label}</th><td>{fmt(factor.selected)}</td><td>{fmt(factor.alternative)}</td></tr>)}
        </tbody>
        <tfoot><tr><th scope="row">Total</th><td>{fmt(Number(decision.selected.cost))}</td><td>{fmt(Number(option.cost))}</td></tr></tfoot>
      </table>
    </details>
  </section>
}
