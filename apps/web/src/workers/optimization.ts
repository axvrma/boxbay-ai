import { opportunities } from '../simulation/engine'
import type { State, Opportunity } from '../simulation/engine'
import type { Bundle } from '../intelligence/inference'
import type { DemoData } from '../simulation/types'

export type Request = { type: 'init'; data: DemoData; bundle: Bundle } | { type: 'review'; state: State }
export type Response = { opportunities: Opportunity[] } | { error: string }
let assets: { data: DemoData; bundle: Bundle } | undefined

self.onmessage = ({ data }: MessageEvent<Request>) => {
  if (data.type === 'init') {
    assets = data
    return
  }
  try {
    if (!assets) throw Error('The optimizer is missing its model and facility.')
    self.postMessage({ opportunities: opportunities(data.state, assets.data, assets.bundle) } satisfies Response)
  } catch (error: unknown) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) } satisfies Response)
  }
}
