export type CiState = 'checking' | 'none' | 'queued' | 'running' | 'failed' | 'partial' | 'passed' | 'cancelled'

export type Ci = {
  branch: string
  state: CiState
  sha: string
  detail: string
  primary: string
  now: number
}

export type Bar = {
  branch: string
  model: string
  contextPercent: number | null
  sessionStartedAt: number
  added: number
  removed: number
  now: number
}

declare module 'claude-code' {
  interface PluginState {
    'my-mods': { ci: Ci | null; bar: Bar | null }
  }
}
