import { createStore } from 'zustand/vanilla'
import type { State } from './engine'

type Session = {
  state: State
  history: State[]
  commit: (state: State) => void
  previous: () => void
  reset: (state: State) => void
}

export function createSession(initial: State) {
  return createStore<Session>()((set) => ({
    state: initial,
    history: [],
    commit: (state) => set((current) => state === current.state ? current :
      { state, history: [...current.history.slice(-31), current.state] }),
    previous: () => set((current) => {
      const prior = current.history.at(-1)
      return prior ? { state: prior, history: current.history.slice(0, -1) } : current
    }),
    reset: (state) => set({ state, history: [] }),
  }))
}
