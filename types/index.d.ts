export type CIRun = {
  branch: string
  id?: number
  workflow?: string
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
  // The latest run on each of the user's other branches, newest first.
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
