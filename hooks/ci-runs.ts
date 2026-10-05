import type { CIRun } from '../types'
import { FAILING_CONCLUSIONS } from './component'

// Pure helpers only: a hooks module can't pass `$` across an import, so everything
// that calls gh lives in register.tsx and leans on these to read what it gets back.

export const OTHER_BRANCHES_LISTED = 30

const OTHER_BRANCHES_SHOWN = 6

export type Config = Record<string, unknown>

type Step = { name: string; status: string; conclusion: string }

export type Job = Step & { steps?: Step[] }

export type ListedRun = {
  databaseId: number
  headBranch: string
  workflowName: string
  status: string
  conclusion: string
  updatedAt: string
}

export const workflowFor = (branch: string, config: Config) =>
  branch === config.mainBranch && config.githubActionsMainWorkflow
    ? String(config.githubActionsMainWorkflow)
    : String(config.githubActionsBranchWorkflow ?? '')

export const latestPerBranch = (runs: CIRun[]): CIRun[] => {
  const newestFirst = [...runs].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
  const seen = new Set<string>()

  return newestFirst.filter(run => {
    if (seen.has(run.branch)) return false
    seen.add(run.branch)
    return true
  })
}

export const toRun = (branch: string, run: Omit<ListedRun, 'headBranch'>): CIRun => ({
  branch,
  id: run.databaseId,
  workflow: run.workflowName,
  status: run.status,
  conclusion: run.conclusion,
  updatedAt: Date.parse(run.updatedAt),
})

// Which of the user's runs to show: the newest per other branch, on that branch's workflow.
export const latestRunsOnOtherBranches = (
  listed: ListedRun[],
  currentBranch: string,
  config: Config
): CIRun[] =>
  latestPerBranch(
    listed
      .filter(
        run =>
          run.headBranch !== currentBranch &&
          run.workflowName === workflowFor(run.headBranch, config)
      )
      .map(run => toRun(run.headBranch, run))
  ).slice(0, OTHER_BRANCHES_SHOWN)

export const isRunning = (run: CIRun) => !!run.status && run.status !== 'completed'

export const isFinishedWell = (run: CIRun) =>
  run.status === 'completed' && !FAILING_CONCLUSIONS.has(run.conclusion ?? '')

const isActiveOrFailed = (step: Step) =>
  step.status === 'in_progress' || FAILING_CONCLUSIONS.has(step.conclusion)

// "<job> › <step>" for what's running now, or what failed.
export const describeProgress = (jobs: Job[]) => {
  const job = jobs.find(isActiveOrFailed)
  const step = job?.steps?.find(isActiveOrFailed)

  return [job?.name, step?.name].filter(Boolean).join(' › ')
}
