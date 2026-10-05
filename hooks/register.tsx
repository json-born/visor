import type { EngineInterface, Register } from 'claude-code'
import { atom, read, update } from 'claude-code'
import type { CIRun, CIRuns, SessionInfo } from '../types'
import type { Config, Job, ListedRun } from './ci-runs'
import {
  describeProgress,
  latestRunsOnOtherBranches,
  OTHER_BRANCHES_LISTED,
  toRun,
  workflowFor,
} from './ci-runs'
import type { ThemeName } from './component'
import { CI_VIEW, FAILING_CONCLUSIONS } from './component'

export const POLL_TRIGGER_COMMANDS =
  /\bgit\s+push\b|\bgh\s+(run\s+rerun|workflow\s+run|pr\s+create)\b/

const CURRENT_BRANCH_COMMAND = ['git', 'branch', '--show-current']

const SESSION_REFRESH_MS = 5_000
const FAST_POLL_MS = 5_000
const FAST_POLL_AFTER_PUSH_MS = 120_000
const SETTLED_POLL_MS = 60_000
const COMMAND_TIMEOUT_MS = 20_000

const ciRunsAtom = atom({ plugin: 'visor', key: 'ci-runs' } as const, null)
const ciExpandedAtom = atom({ plugin: 'visor', key: 'ci-expanded' } as const, false)
const sessionAtom = atom({ plugin: 'visor', key: 'session' } as const, null)
const clockAtom = atom({ plugin: 'visor', key: 'clock' } as const, null)

const RUN_FIELDS = 'databaseId,headBranch,workflowName,status,conclusion,updatedAt'

type RunOptions = { cwd: string; timeoutMs: number }

let config: Config = {}
let cachedLogin: string | undefined
let fastPollUntil = 0
let wakePollLoop = () => {}

export const register: Register = (on, pluginOptions) => {
  config = pluginOptions

  on('session.start', async ($, event, next) => {
    const result = await next(event)

    await $.command.register({
      name: 'visor',
      description: 'Control the visor status line',
      argumentHint: CI_VIEW,
    })

    await pollSession($)
    $.clock.every(SESSION_REFRESH_MS, () => void pollSession($))

    $.clock.every(1_000, async () => {
      const now = await $.clock.now()
      await update($, clockAtom, () => now)
    })

    ;(async () => {
      while (true) {
        const wake = new AbortController()
        wakePollLoop = () => wake.abort()

        const ciRuns = await pollCIRuns($)
        await update($, ciRunsAtom, () => ciRuns)

        const ciRunning =
          !!ciRuns &&
          [ciRuns.current, ...ciRuns.others].some(run => !!run.status && run.status !== 'completed')
        const shouldPollFast = ciRunning || (await $.clock.now()) < fastPollUntil

        await $.clock
          .sleep(shouldPollFast ? FAST_POLL_MS : SETTLED_POLL_MS, { signal: wake.signal })
          .catch(error => {
            if (!wake.signal.aborted) throw error
          })
      }
    })().catch(error => {
      try {
        $.ui.toast(`GitHub polling stopped: ${error instanceof Error ? error.message : error}`)
      } catch {}
    })

    return result
  })

  on('tool.call', { tool: 'Bash' }, async ($, event, next) => {
    const result = await next(event)

    if (POLL_TRIGGER_COMMANDS.test(event.command)) {
      fastPollUntil = (await $.clock.now()) + FAST_POLL_AFTER_PUSH_MS
      wakePollLoop()
    }

    return result
  })

  on('ui.message', async ($, event, next) => {
    const { data } = event

    if (typeof data === 'object' && data !== null && 'toggle' in data && data.toggle === CI_VIEW) {
      await toggleCIView($)
      return {}
    }

    return next(event)
  })

  on('command.run', { command: 'visor' }, async ($, event) => {
    if (event.args.trim() !== CI_VIEW) return { text: `Usage: /visor ${CI_VIEW}` }

    const result = await toggleCIView($)

    return { text: result === 'nothing' ? 'No other branches to expand.' : `CI view ${result}.` }
  })

  on('ui.render', { component: 'PromptHint' }, async ($, event, next) => {
    const hint = await next(event)

    const session = await read($, sessionAtom)
    const elements = $.ui.resolve(event)
    const Client = 'Client' in elements ? elements.Client : undefined

    if (session === null || !Client) return hint

    const { Box } = elements
    const ci = await read($, ciRunsAtom)
    const expanded = await read($, ciExpandedAtom)
    const now = await read($, clockAtom)

    return (
      <Box flexDirection="column">
        {hint}
        <Client
          key="visor"
          module="./component.tsx"
          width="100%"
          props={{ ...session, ci, expanded, now, theme: config.theme as ThemeName }}
        />
      </Box>
    )
  })
}

const pollSession = async ($: EngineInterface) => {
  const cwd = await $.session.cwd()

  const [usage, modelId, branch, shortstat] = await Promise.all([
    $.session.usage(),
    $.session.model(),
    $.process.run(CURRENT_BRANCH_COMMAND, { cwd }),
    $.process.run(['git', 'diff', '--shortstat', 'HEAD'], { cwd }),
  ])

  const session: SessionInfo = {
    branch: branch.exitCode === 0 ? branch.stdout.trim() : '',
    model: formatModelName(modelId),
    contextPercent: usage.context.percent ?? null,
    sessionStartedAt: usage.startedAt,
    ...(shortstat.exitCode === 0 ? parseShortstat(shortstat.stdout) : { added: 0, removed: 0 }),
  }

  await update($, sessionAtom, () => session)
}

// Collapsing always works, but there's nothing to expand without other branches.
const toggleCIView = async ($: EngineInterface): Promise<'expanded' | 'collapsed' | 'nothing'> => {
  const ci = await read($, ciRunsAtom)
  const hasOthers = !!ci?.others.length
  const expanded = await update($, ciExpandedAtom, expanded => (hasOthers ? !expanded : false))

  return expanded ? 'expanded' : hasOthers ? 'collapsed' : 'nothing'
}

const pollCIRuns = async ($: EngineInterface): Promise<CIRuns | null> => {
  const shown = await read($, ciRunsAtom)

  try {
    const cwd = await $.session.cwd()
    const options = { cwd, timeoutMs: COMMAND_TIMEOUT_MS }
    const branch = await $.process.run(CURRENT_BRANCH_COMMAND, options)
    const branchName = branch.exitCode === 0 ? branch.stdout.trim() : ''

    if (!branchName) return null

    const workflow = workflowFor(branchName, config)

    if (!workflow) return null

    const [current, others] = await Promise.all([
      fetchCurrent($, branchName, workflow, options).then(run =>
        addDetail($, run, options).catch(() => run)
      ),
      fetchOthers($, branchName, options),
    ])

    const otherRuns = (others ?? shown?.others ?? []).filter(run => run.branch !== branchName)

    return {
      current,
      others: await Promise.all(otherRuns.map(run => addDetail($, run, options).catch(() => run))),
    }
  } catch (error) {
    $.ui.toast(`GitHub poll failed: ${error instanceof Error ? error.message : error}`)
    return shown
  }
}

const fetchCurrent = async (
  $: EngineInterface,
  branch: string,
  workflow: string,
  options: RunOptions
): Promise<CIRun> => {
  const listing = await $.process.run(
    [
      'gh',
      'run',
      'list',
      '--branch',
      branch,
      '--workflow',
      workflow,
      '-L',
      '1',
      '--json',
      RUN_FIELDS,
    ],
    options
  )

  if (listing.exitCode !== 0) return { branch, error: listing.stderr.trim() }

  const [latest]: Omit<ListedRun, 'headBranch'>[] = JSON.parse(listing.stdout)

  return latest ? toRun(branch, latest) : { branch }
}

// The newest run on each branch the signed-in user has triggered CI for, or null
// when they couldn't be listed so the last good rows stay up.
const fetchOthers = async (
  $: EngineInterface,
  branch: string,
  options: RunOptions
): Promise<CIRun[] | null> => {
  if (cachedLogin === undefined) {
    const whoami = await $.process.run(['gh', 'api', 'user', '-q', '.login'], options)

    if (whoami.exitCode !== 0 || !whoami.stdout.trim()) return null

    cachedLogin = whoami.stdout.trim()
  }

  const listing = await $.process.run(
    [
      'gh',
      'run',
      'list',
      '--user',
      cachedLogin,
      '-L',
      String(OTHER_BRANCHES_LISTED),
      '--json',
      RUN_FIELDS,
    ],
    options
  )

  if (listing.exitCode !== 0) return null

  try {
    return latestRunsOnOtherBranches(JSON.parse(listing.stdout), branch, config)
  } catch {
    return null
  }
}

const addDetail = async ($: EngineInterface, run: CIRun, options: RunOptions): Promise<CIRun> => {
  const { id, status, conclusion = '' } = run

  if (id === undefined || (status === 'completed' && !FAILING_CONCLUSIONS.has(conclusion)))
    return run

  const viewed = await $.process.run(['gh', 'run', 'view', String(id), '--json', 'jobs'], options)

  const { jobs }: { jobs: Job[] } = viewed.exitCode === 0 ? JSON.parse(viewed.stdout) : { jobs: [] }

  return { ...run, detail: describeProgress(jobs) }
}

export const parseShortstat = (output: string) => ({
  added: Number(/(\d+) insertion/.exec(output)?.[1] ?? 0),
  removed: Number(/(\d+) deletion/.exec(output)?.[1] ?? 0),
})

export const formatModelName = (modelId: string) => {
  const withoutSuffix = modelId.replace(/\[.*\]$/, '')
  const match = /^claude-([a-z]+)-(\d+)-(\d+)/.exec(withoutSuffix)

  if (!match) return modelId

  const [, family = '', major, minor] = match

  return `${family.charAt(0).toUpperCase()}${family.slice(1)} ${major}.${minor}`
}
