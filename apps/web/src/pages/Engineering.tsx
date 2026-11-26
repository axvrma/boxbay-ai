import { useEffect, useMemo, useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { dubaiTime, formatDubai, predict } from '../intelligence/inference'
import type { Bundle } from '../intelligence/inference'
import { evaluate, initialize } from '../simulation/engine'
import type { Policy } from '../simulation/engine'
import { physics } from '../simulation/physics'
import { policyNames } from '../simulation/experiment'
import type { Cargo, DemoData, Operating } from '../simulation/types'

const sections = [
  ['context','Jebel Ali context'],['architecture','Architecture'],['data','Synthetic data'],['model','Model evaluation'],
  ['playground','Live prediction playground'],['seasonal','Seasonal intelligence'],['allocation','Allocation'],
  ['handling','Pallet and stacker'],['physics','Physics and cost'],['benchmark','Benchmarks'],
  ['deployment','Deployment'],['production','Production readiness'],
]
type Stats = { n:number; mae:number; rmse:number; medianAbsoluteError:number; bias:number; wape:number }
type Score = {
  model: Stats; baseline: Stats; coverage: number; splits: number[]; residuals: number[]
  seasonal: Record<string,Stats>; unseenReceivers?: Stats; commodity?: Record<string,Stats>
}
type ModelEvidence = {
  version: string; library: string; artifactBytes: number; parameters: Record<string,number|string>; training: string
  calibration: string; test: string; metrics: Record<string,Score>; artifactSha256: string
}
type DataEvidence = {
  manifest: { seed: number; containers: number; dailyRecords: number; start: string; end: string;
    commodityCounts: Record<string,number>; validation: Record<string,boolean> }
  sample: { containerId: string; arrivalTimestamp: string; originPort: string; commodity: number; grossWeightKg: number; dwellTimeDays:number }[]
  daily: { date: string; arrivals: number; pickups: number }[]
}
type Benchmark = {
  conditions: string[]; method: string; seeds: number[]; summaries: {
    condition: string; policy: Policy; kwh: number; retrieval: number | null; cost: number; moves: number
    sla: number; shipped: number; unserved: number; rejected: number; adverseCostPairs: number; minCostDelta: number; maxCostDelta: number
  }[]
}
type Assets = { dataset: DataEvidence; model: ModelEvidence; benchmark: Benchmark }
const num = (value: number | null, digits = 2) => value === null ? '—' : value.toLocaleString('en-GB',{
  minimumFractionDigits: digits, maximumFractionDigits: digits,
})

function FeaturePlayground({ data, bundle }: {data: DemoData; bundle: Bundle}) {
  const [left, setLeft] = useState(data.defaultDate)
  const [right, setRight] = useState('2026-03-10')
  const [difference, setDifference] = useState<number>()
  const [base, setBase] = useState({ ...data.incoming[0] })
  const [compareCargo, setCompareCargo] = useState({ ...data.incoming[0] })
  const [operatingA, setA] = useState(data.scenarios[0])
  const [operatingB, setB] = useState(data.scenarios[0])
  const a = useMemo(() => predict(bundle,data,base,dubaiTime(left),operatingA), [bundle,data,base,left,operatingA])
  const b = useMemo(() => predict(bundle,data,compareCargo,dubaiTime(right),operatingB), [bundle,data,compareCargo,right,operatingB])
  function lab(name: string, cargo: Cargo, setCargo: (value: Cargo)=>void, date:string, setDay:(value:string)=>void,
    operating: Operating, update:(value: Operating)=>void, output: typeof a) {
    const scale = Math.max(.1, Math.abs(output.sensitivity[0]?.days ?? 0))
    return <div className="playground-card">
      <h3>{name}</h3>
      <label>Arrival date<input aria-label={name+' arrival date'} type="date" min={data.dateMin} max={data.dateMax} value={date} onChange={(e) => {
        if (e.currentTarget.value >= data.dateMin && e.currentTarget.value <= data.dateMax) setDay(e.currentTarget.value)
      }}/></label>
      <label>Commodity<select value={cargo.commodity} onChange={(e) => setCargo({...cargo, commodity:Number(e.currentTarget.value)})}>
        {data.commodities.map((value,index)=><option key={value} value={index}>{value}</option>)}</select></label>
      <label>Vendor<select value={cargo.receiver} onChange={(e) => setCargo({...cargo, receiver:Number(e.currentTarget.value)})}>
        {data.receivers.map((value,index)=><option key={value.id} value={index}>{value.name}</option>)}
        <option value={-1}>Unseen vendor</option></select></label>
      <label>Origin<select value={cargo.lane} onChange={(e) => setCargo({...cargo, lane:Number(e.currentTarget.value)})}>
        {data.ports.map((value,index)=><option key={index} value={index}>{value}{value === 'Jebel Ali' ? ' → ' + data.destinations[index] : ''}</option>)}</select></label>
      <label>Weight · t<input type="number" min="7" max={cargo.size===20?28:36} step=".5" value={cargo.kg/1000}
        onChange={(e) => {if(e.currentTarget.valueAsNumber >= 7 && e.currentTarget.valueAsNumber <= (cargo.size===20?28:36))
          setCargo({...cargo,kg:e.currentTarget.valueAsNumber*1000})}}/></label>
      <label>Scenario<select value={operating.id} onChange={(e) => {
        const option = data.scenarios.find(({id})=>id===e.currentTarget.value)
        if(option) update(option)
      }}>{data.scenarios.map(({id,name})=><option key={id} value={id}>{name}</option>)}</select></label>
      {(['occupancy','congestion','truck'] as const).map((key) => <label key={key}>
        {key === 'truck' ? 'Truck capacity' : key[0].toUpperCase()+key.slice(1)}
        <input type="range" aria-label={name+' '+key} min="0" max="1" step=".01" value={operating[key]}
          onChange={(e)=>update({...operating,[key]:Number(e.currentTarget.value)})}/><output>{Math.round(operating[key]*100)}%</output></label>)}
      <label>Crane access<select value={operating.cranes} onChange={(e)=>update({...operating,cranes:Number(e.currentTarget.value)})}>
        <option value={2}>Both racks</option><option value={1}>One rack</option><option value={0}>Offline</option></select></label>
      <div className="result">{output.days.toFixed(2)} days</div>
      <p>{formatDubai(output.pickup)} · {output.event}</p>
      <p>{output.low !== null && output.high !== null ? `${output.low.toFixed(1)}–${output.high.toFixed(1)} d synthetic interval` : 'Interval unavailable'} · {output.durationMs.toFixed(2)} ms</p>
      {output.sensitivity.slice(0,4).map(({feature,days})=><div key={feature} className="sensitivity">
        <div className="factor"><span>{feature}</span>
          <strong className={days<0?'green-text':'amber-text'}>{days>0?'+':''}{days.toFixed(2)} d</strong></div>
        <div className="sensitivity-track" aria-hidden="true"><i style={{ width:`${Math.abs(days)/scale*100}%`,
          background:days<0?'var(--green)':'var(--amber)' }}/></div>
      </div>)}
    </div>
  }
  const delta=b.days-a.days
  return <>
    <div className="columns">{lab('Input A',base,setBase,left,setLeft,operatingA,setA,a)}
      {lab('Input B',compareCargo,setCompareCargo,right,setRight,operatingB,setB,b)}</div>
    <p><strong>{delta>=0?'+':''}{delta.toFixed(2)} days</strong> for Input B relative to Input A.
      {difference !== undefined && ` Saved comparison ${difference.toFixed(2)} days.`}</p>
    <div><button type="button" className="button" onClick={()=>setDifference(delta)}>Pin current difference</button></div>
  </>
}

export default function Engineering({ data,bundle }: {data:DemoData;bundle:Bundle}) {
  const [evidence,setEvidence]=useState<Assets>()
  const [failure,setFailure]=useState('')
  const [sample,setSample]=useState(0)
  const [scenario,setScenario]=useState('normal')
  const [allocationDate,setAllocationDate]=useState(data.defaultDate)
  const worked=useMemo(() => {
    const base=initialize(data,bundle,allocationDate)
    return evaluate(base,data,bundle)
  }, [data,bundle,allocationDate])
  useEffect(()=>{
    const controller = new AbortController()
    const fetchEvidence = async <T,>(name: string) => {
      const response = await fetch(import.meta.env.BASE_URL + 'evidence/' + name + '.json', { signal:controller.signal })
      if(!response.ok) throw Error('Evidence could not be loaded.')
      return response.json() as Promise<T>
    }
    void Promise.all([fetchEvidence<DataEvidence>('dataset'),fetchEvidence<ModelEvidence>('model-evaluation'),
      fetchEvidence<Benchmark>('simulation-benchmark')]).then(([dataset,model,benchmark])=>setEvidence({dataset,model,benchmark}))
      .catch((error:unknown)=>{if(!controller.signal.aborted) setFailure(error instanceof Error?error.message:String(error))})
    return ()=>controller.abort()
  },[])
  const model=evidence?.model
  const stats=model?.metrics.dwell
  const samples=evidence?.dataset.sample ?? []
  const row=samples[sample]
  const benchmark=evidence?.benchmark
  const residuals=useMemo(()=>{
    const samples=stats?.residuals ?? []
    return Array.from({length:13},(_,i)=>{
      const min=(i-6)*.5
      return { offset:min, count:samples.filter((r)=>r>=min-.25 && r<min+.25).length }
    })
  },[stats])
  return <div className="engineering">
    <nav aria-label="Engineering sections">{sections.map(([id,label])=><a key={id} href={'#'+id}>{label}</a>)}</nav>
    <article>
      <header><h1>Engineering the live decision</h1><p>From advance shipment data to a verified storage position.</p></header>
      {failure && <div role="alert" className="inline-alert">{failure}</div>}
      <section id="context"><h2>Jebel Ali context</h2>
        <p>DP World documented 792 storage positions at the Terminal 4 BOXBAY trial and more than 63,000 moves by August 2021.
          The 15.5 million TEU reported for 2024 covers Jebel Ali Port as a whole. Each high-bay position supports individual access.
          This independent 64-cell demonstrator explores the incremental value of predictive placement on that type of infrastructure.</p>
        <div className="stat-row">
          <a href="https://www.dpworld.com/en/news/dp-world-celebrates-boxbay-milestone-with-completion-of-the-first-10000-container-moves">Terminal 4 trial</a>
          <a href="https://www.dpworld.com/en/news/successful-real-world-trial-of-boxbay-high-bay-storage-system-completed">Trial results</a>
          <a href="https://www.dpworld.com/en/news/releases/uae/dp-world-records-highest-cargo-volumes-at-jebel-ali-port-since-2015">2024 port volumes</a>
          <a href="https://www.dpworld.com/en/ports-terminals/uae/jebel-ali-port">Jebel Ali Port</a></div>
      </section>
      <section id="architecture"><h2>Architecture</h2>
        {[
          ['Synthetic data → feature engineering','Seeded container and daily demand records produce time-aware numerical inputs.'],
          ['Training → model artifacts','Python fits XGBoost on chronological partitions and exports tree nodes, numeric references, evaluation and parity fixtures.'],
          ['Browser inference → allocation','Portable trees calculate dwell and expected demand. The constraint filter and unit-normalized score rank feasible cells.'],
          ['Placement approval → simulation state','The operator can accept the recommendation or choose a feasible rack, row and column. The action state commits custody, equipment positions and movement totals.'],
          ['Simulation state → digital twin and business metrics','The renderer animates the approved equipment legs. The business strip reads the same committed inventory and movement ledger.'],
        ].map(([label,body])=><details key={label}><summary>{label}</summary><p>{body}</p></details>)}
      </section>
      <section id="data"><h2>Synthetic data and validation</h2>
        {evidence && <>
          <p>{num(evidence.dataset.manifest.containers,0)} records and {num(evidence.dataset.manifest.dailyRecords,0)} daily observations,
            {evidence.dataset.manifest.start} through {evidence.dataset.manifest.end}. Seed {evidence.dataset.manifest.seed}.</p>
          <p>Arrival timestamps are ordered. Departure labels follow arrival. Receiver history is updated only after completed pickups. The yard, vessel schedules and named vendor profiles are synthetic. The vendor is the receiver represented in the model.</p>
          <details><summary>Commodity distribution and receiver profiles</summary>
            <p>{Object.entries(evidence.dataset.manifest.commodityCounts).map(([name,n])=>`${name} ${num(n,0)}`).join(' · ')}</p>
            <p>{data.receivers.map(({name,dwell,reliability})=>`${name} (${dwell} d, ${Math.round(reliability*100)}% prior reliability)`).join(' · ')}</p>
            <p>{data.ports.map((port,i)=>`${port} → ${data.destinations[i]}`).join(' · ')}</p>
          </details>
        </>}
        {row && <><label>Sample record <select value={sample} onChange={(e)=>setSample(Number(e.currentTarget.value))}>
          {samples.map((item,i)=><option key={item.containerId} value={i}>{item.containerId}</option>)}</select></label>
          <p>{row.originPort} · {data.commodities[row.commodity]} · {(row.grossWeightKg/1000).toFixed(1)} t · {formatDubai(Date.parse(row.arrivalTimestamp))} · {row.dwellTimeDays.toFixed(2)} d realized synthetic target</p>
          <a href={import.meta.env.BASE_URL+'evidence/container-sample.csv'} download>Download synthetic CSV sample</a></>}
      </section>
      <section id="model"><h2>Model evaluation</h2>
        <p>All holdout results describe synthetic observations. Cold-start inputs use documented group priors without an identity code.</p>
        {model && stats && <>
          <p>{model.library} · {model.version} · {num(model.artifactBytes/1024,0)} KiB.
            Train {model.training}, calibrate {model.calibration}, test {model.test}. Dwell split {stats.splits.map((n)=>num(n,0)).join(' / ')}.</p>
          <div className="table-wrap"><table><thead><tr><th>Model</th><th>Unit</th><th>MAE</th><th>Baseline MAE</th><th>RMSE</th><th>Interval coverage</th></tr></thead>
            <tbody>{Object.entries(model.metrics).map(([name,value])=><tr key={name}><td>{name}</td><td>{name==='dwell'?'Days':'Containers'}</td>
              <td>{num(value.model.mae)}</td><td>{num(value.baseline.mae)}</td><td>{num(value.model.rmse)}</td><td>{num(value.coverage*100,1)}%</td></tr>)}</tbody></table></div>
          {model.metrics.pickups.model.mae > model.metrics.pickups.baseline.mae && <p>The 24-hour pickup model trailed its historical-mean baseline. Treat it as a diagnostic estimate in the demo.</p>}
          <p>Dwell median absolute error {num(stats.model.medianAbsoluteError)} days.
            {stats.unseenReceivers && ` Unseen receivers ${num(stats.unseenReceivers.mae)} days MAE across ${num(stats.unseenReceivers.n,0)} rows.`}</p>
          <div className="chart" aria-label="Synthetic dwell holdout residual distribution"><ResponsiveContainer>
            <LineChart data={residuals}><CartesianGrid stroke="var(--border)"/><XAxis dataKey="offset" tick={{fill:'var(--muted)'}}/>
              <YAxis allowDecimals={false} tick={{fill:'var(--muted)'}}/><Tooltip/><Line name="Sample count by residual (days)" dataKey="count" stroke="var(--blue)" isAnimationActive={false}/></LineChart>
          </ResponsiveContainer></div>
          <details><summary>Seasonal results and training configuration</summary>
            <p>{Object.entries(stats.seasonal).map(([label,value])=>`${label} ${num(value.mae)} d MAE (n=${num(value.n,0)})`).join(' · ')}</p>
            <p>{Object.entries(model.parameters).map(([label,value])=>`${label}=${value}`).join(' · ')}</p>
            <p>Inputs {bundle.models.dwell.features.join(' · ')}.</p>
          </details>
        </>}
      </section>
      <section id="playground"><h2>Live prediction playground</h2>
        <p>Each column calls the same model as the demo. Single-feature sensitivity compares the prediction with one input replaced by the training median. Effects can overlap and do not establish causation.</p>
        <FeaturePlayground data={data} bundle={bundle}/>
      </section>
      <section id="seasonal"><h2>Seasonal intelligence</h2>
        <p>Features use Gulf Standard Time and a versioned calendar of illustrative regional windows. Ramadan and Eid affect pickup capacity and low-priority cargo in the generator. Year-end retail accelerates selected goods and Lunar New Year raises modeled dwell on selected East Asian lanes. Calendar windows and effects are synthetic planning assumptions.</p>
        <p>{data.eventNames.slice(1).join(' · ')}</p>
        {evidence && <div className="chart" aria-label="Sampled synthetic training demand"><ResponsiveContainer>
          <LineChart data={evidence.dataset.daily}><CartesianGrid stroke="var(--border)"/><XAxis dataKey="date" minTickGap={72} tick={{fill:'var(--muted)'}}/>
            <YAxis tick={{fill:'var(--muted)'}}/><Tooltip/><Line name="Inbound" dataKey="arrivals" stroke="var(--blue)" dot={false} isAnimationActive={false}/>
            <Line name="Pickups" dataKey="pickups" stroke="var(--green)" dot={false} isAnimationActive={false}/></LineChart>
        </ResponsiveContainer></div>}
      </section>
      <section id="allocation"><h2>Slot allocation</h2>
        <p>Scan every cell. Reject blocked, occupied, unreachable, overweight, size-incompatible, unpowered, unsegregated or reserved cells. Rank feasible cells by a dimensionless sum of placement (.30), retrieval (.37), capacity (.18), crane workload (.08) and SLA risk (.07). Each term uses documented physical references in the source.</p>
        <label>Worked example date <input type="date" value={allocationDate} min={data.dateMin} max={data.dateMax}
          onChange={(e)=>{if(e.currentTarget.value>=data.dateMin&&e.currentTarget.value<=data.dateMax)setAllocationDate(e.currentTarget.value)}}/></label>
        <p>{worked?.choices.length ?? 0} feasible. {Object.entries(worked?.rejected ?? {}).map(([key,count])=>`${count} ${key.toLowerCase()}`).join(' · ')}.</p>
        <div className="table-wrap"><table><thead><tr><th>Slot</th><th>Score</th><th>Placement kWh</th><th>Retrieval s</th><th>Capacity score</th></tr></thead>
          <tbody>{worked?.choices.slice(0,5).map((r)=><tr key={r.slot.id}><td>{r.slot.id}</td><td>{num(r.score,3)}</td>
            <td>{num(r.placement.kwh)}</td><td>{num(r.retrieval.seconds,0)}</td><td>{num(r.components.capacity,3)}</td></tr>)}</tbody></table></div>
      </section>
      <section id="handling"><h2>Pallet and stacker</h2>
        <p>Two rack faces share one aisle. Containers lie lengthwise along each rack face. The inbound pallet moves on floor rails and stops at the handoff. The stacker locks onto the container and lifts it clear, then travels along the aisle while lifting to the required row. Its telescopic spreader extends sideways into the bay, sets the container down and retracts.</p>
        <p>This sequence follows the pallet circulation and stacker footage at 2:28–2:50 and 3:22–3:53 in the supplied BOXBAY reference. Dimensions and timing are demonstration assumptions.</p>
      </section>
      <section id="physics"><h2>Physics and cost</h2>
        <ul>
          <li>Lift potential is m × {physics.gravity} × height change, divided by 3.6 million to get kWh. Lift efficiency is {physics.liftEfficiency}; lowering recovers a fraction of {physics.regeneration}. Draw is clipped at zero for a movement leg.</li>
          <li>Aisle travel and hoisting can run concurrently. Sideways spreader extension happens at the chosen row. The movement estimate also accounts for auxiliary power and powered idle. Tray draw combines distance and loaded mass. The model serializes equipment in each action.</li>
          <li>Cost in AED is kWh × electricity + km × equipment + active hours × time. Illustrative defaults are {data.rates.electricity} AED/kWh, {data.rates.equipment} AED/km and {data.rates.time} AED/h.</li>
          <li>Modeled CO₂e is energy × {data.rates.emissions} kg/kWh. USD uses {data.rates.usd} USD per AED. Both are illustrative inputs editable in the demo.</li>
        </ul>
      </section>
      <section id="benchmark"><h2>Matched simulation benchmarks</h2>
        {benchmark && <>
          <p>{benchmark.method} {benchmark.seeds.length} matched seeds per condition. Pickup means describe completed pickups. Compare alongside unserved demand and adverse pairs.</p>
          <label>Benchmark condition <select value={scenario} onChange={(e)=>setScenario(e.currentTarget.value)}>
            {benchmark.conditions.map((id)=><option key={id} value={id}>{data.scenarios.find((s)=>s.id===id)?.name ?? id.replace('-',' ')}</option>)}
          </select></label>
          <div className="table-wrap"><table><thead><tr><th>Policy</th><th>Energy kWh</th><th>Pickup s</th><th>AED</th>
            <th>Moves</th><th>SLA</th><th>Unserved</th><th>Adverse cost pairs</th></tr></thead>
          <tbody>{benchmark.summaries.filter((s)=>s.condition===scenario).map((r)=><tr key={r.policy} title={`Paired cost range AED ${num(r.minCostDelta)} to ${num(r.maxCostDelta)}`}>
            <td>{policyNames[r.policy]}</td><td>{num(r.kwh)}</td><td>{num(r.retrieval,1)}</td><td>{num(r.cost)}</td>
            <td>{num(r.moves,1)}</td><td>{num(r.sla*100,1)}%</td><td>{num(r.unserved,1)}</td>
            <td>{r.adverseCostPairs} / {benchmark.seeds.length}</td></tr>)}</tbody></table></div>
          <p>Adverse pairs count cost increases versus first available. Hover a policy row for the minimum and maximum paired cost deltas.</p>
        </>}
      </section>
      <section id="deployment"><h2>Deployment</h2>
        <p>Local Python creates synthetic data and portable XGBoost artifacts. Vite deploys the application with same-origin assets. Netlify serves the two routes. The previous multi-service runtime used an API, managed services and static event recordings.</p>
        <p>Run <code>npm ci</code>, <code>npm run dev</code> or <code>npm run build</code>. Run training and benchmark generation explicitly when publishing refreshed evidence.</p>
      </section>
      <section id="production"><h2>Production readiness</h2>
        <p>This independent proof of concept simulates equipment. Terminal integration would require actual dwell and vessel histories, verified restrictions and crane geometry, telemetry, energy calibration, approval workflows, shadow-mode safety validation, audit records, model drift monitoring and scheduled retraining.</p>
      </section>
    </article>
  </div>
}
