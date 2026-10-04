export type GithubActionsStatus = {
  branch: string
  // The newest run of the CI workflow, as gh reports it; unset when there isn't one.
  status?: string
  conclusion?: string
  // "<job> › <step>" for what's running now, or what failed.
  detail?: string
  // What gh said when it couldn't list the workflow's runs.
  error?: string
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
      'github-actions': GithubActionsStatus | null
      session: SessionInfo | null
      clock: number | null
    }
  }
}
