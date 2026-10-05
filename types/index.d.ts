export type CIRun = {
  branch: string
  // The run's id, for looking up its jobs; unset when there isn't a run.
  id?: number
  workflow?: string
  // The newest run of the CI workflow, as gh reports it; unset when there isn't one.
  status?: string
  conclusion?: string
  // "<job> › <step>" for what's running now, or what failed.
  detail?: string
  // What gh said when it couldn't list the workflow's runs.
  error?: string
  // When the run last changed, in ms since the epoch.
  updatedAt?: number
}

export type CIRuns = {
  current: CIRun
  // The newest run on each of the user's other branches, newest first.
  others: CIRun[]
}

export type SessionInfo = {
  branch: string
  model: string
  contextPercent: number | null
  sessionStartedAt: number
  added: number
  removed: number
}

declare module 'claude-code' {
  interface PluginState {
    visor: {
      'ci-runs': CIRuns | null
      'ci-expanded': boolean
      session: SessionInfo | null
      clock: number | null
    }
  }
}
