import type { CiState } from '../types'

export type Run = { databaseId: number; name: string; status: string; conclusion: string; headSha: string; event: string }
type Step = { name: string; status: string; conclusion: string }
export type Job = { name: string; status: string; conclusion: string; steps?: Step[] }

const BAD = new Set(['failure', 'timed_out', 'startup_failure'])
export const SETTLED = new Set<CiState>(['passed', 'partial', 'failed', 'cancelled'])
export const TRIGGERS = /\bgit\s+push\b|\bgh\s+(run\s+rerun|workflow\s+run|pr\s+create)\b/

export const primaryFor = (branch: string) => (branch === 'main' ? 'Pipeline' : 'Deploy CI Environment')

const names = (runs: Run[]) => [...new Set(runs.map(r => r.name))].join(', ')

export const summariseRuns = (all: Run[], head: string, primaryName: string) => {
  const runs = all.filter(r => r.event !== 'dynamic')
  const sha = runs[0]?.headSha ?? ''
  const current = runs
    .filter(r => r.headSha === sha)
    .filter((r, i, all) => !(r.conclusion === 'cancelled' && all.slice(0, i).some(newer => newer.name === r.name)))
  const isActive = (r: Run) => r.status !== 'completed'
  const primary = current.filter(r => r.name === primaryName)
  const hasPrimary = primary.length > 0
  const pActive = primary.filter(isActive)
  const active = pActive.length ? pActive : current.filter(isActive)
  const bad = (hasPrimary ? primary : current).filter(r => BAD.has(r.conclusion))
  const secondaryBad = hasPrimary ? current.filter(r => r.name !== primaryName && BAD.has(r.conclusion)) : []
  const state: CiState =
    current.length === 0 ? 'none'
    : active.some(r => r.status === 'in_progress') ? 'running'
    : active.length > 0 ? 'queued'
    : bad.length > 0 ? 'failed'
    : secondaryBad.length > 0 ? 'partial'
    : current.some(r => r.conclusion === 'cancelled') ? 'cancelled'
    : 'passed'

  return {
    state,
    sha: sha && sha !== head ? sha.slice(0, 7) : '',
    detail: state === 'partial' ? names(secondaryBad) : names(active),
    activeId: (active.find(r => r.status === 'in_progress') ?? active[0])?.databaseId,
    failedId: bad[0]?.databaseId,
    blockerId:
      state === 'queued'
        ? runs.find(r => r.headSha !== sha && r.status !== 'completed' && r.name === active[0]?.name)?.databaseId
        : undefined,
  }
}

const parts = (job: Job) => job.name.split(' / ')
const label = (job: Job, step?: Step) => [parts(job).slice(parts(job).length > 1 ? 1 : 0).join(' / '), step?.name].filter(Boolean).join(' › ')
const group = (job: Job) => (parts(job).length > 2 ? parts(job).slice(0, -1).join(' / ') : job.name)
const base = (job: Job) => group(job).split(' / ').pop() ?? job.name

export const running = (jobs: Job[]) => {
  const job = jobs.find(j => j.status === 'in_progress') ?? jobs.find(j => j.status !== 'completed')
  const siblings = job ? jobs.filter(j => group(j) === group(job)) : []
  const runningCount = siblings.filter(j => j.status === 'in_progress').length
  return {
    isRunning: job?.status === 'in_progress',
    detail: !job
      ? ''
      : runningCount > 1
        ? `${base(job)}: ${runningCount} jobs running`
        : label(job, job.steps?.find(s => s.status === 'in_progress')),
  }
}

export const failure = (jobs: Job[]) => {
  const job = jobs.find(j => BAD.has(j.conclusion))
  return job ? label(job, job.steps?.find(s => BAD.has(s.conclusion))) : ''
}
