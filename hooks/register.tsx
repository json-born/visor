import type { EngineInterface, Register } from 'claude-code'
import { atom, read, update } from 'claude-code'
import type { GithubActionsStatus, SessionInfo } from '../types'
import { FAILING_CONCLUSIONS } from './component'

export const POLL_TRIGGER_COMMANDS =
  /\bgit\s+push\b|\bgh\s+(run\s+rerun|workflow\s+run|pr\s+create)\b/

const CURRENT_BRANCH_COMMAND = ['git', 'branch', '--show-current']

const SESSION_REFRESH_MS = 5_000
const FAST_POLL_MS = 5_000
const FAST_POLL_AFTER_PUSH_MS = 120_000
const SETTLED_POLL_MS = 60_000
const COMMAND_TIMEOUT_MS = 20_000

type Step = { name: string; status: string; conclusion: string }

const githubActionsAtom = atom({ plugin: 'visor', key: 'github-actions' } as const, null)
const sessionAtom = atom({ plugin: 'visor', key: 'session' } as const, null)
const clockAtom = atom({ plugin: 'visor', key: 'clock' } as const, null)

let fastPollUntil = 0
let wakePollLoop = () => {}

export const register: Register = on => {
  on('session.start', async ($, event, next) => {
    const result = await next(event)

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

        const githubResult = await pollGithub($)
        await update($, githubActionsAtom, () => githubResult)

        const githubActionsRunning = !!githubResult?.status && githubResult.status !== 'completed'
        const shouldPollFast = githubActionsRunning || (await $.clock.now()) < fastPollUntil

        await $.clock
          .sleep(shouldPollFast ? FAST_POLL_MS : SETTLED_POLL_MS, { signal: wake.signal })
          .catch(error => {
            if (!wake.signal.aborted) throw error
          })
      }
    })().catch(error => {
      // The plugin unloading aborts the sleep, and with it every call on $: nothing to show then.
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

  on('ui.render', { component: 'PromptHint' }, async ($, event, next) => {
    const hint = await next(event)

    const session = await read($, sessionAtom)
    const elements = $.ui.resolve(event)
    const Client = 'Client' in elements ? elements.Client : undefined

    if (session === null || !Client) return hint

    const { Box } = elements
    const actions = await read($, githubActionsAtom)
    const now = await read($, clockAtom)

    return (
      <Box flexDirection="column">
        {hint}
        <Client
          key="visor"
          module="./component.tsx"
          width="100%"
          props={{ ...session, actions, now }}
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

const pollGithub = async ($: EngineInterface): Promise<GithubActionsStatus | null> => {
  const shown = await read($, githubActionsAtom)

  try {
    const cwd = await $.session.cwd()
    const options = { cwd, timeoutMs: COMMAND_TIMEOUT_MS }
    const branch = await $.process.run(CURRENT_BRANCH_COMMAND, options)
    const branchName = branch.exitCode === 0 ? branch.stdout.trim() : ''

    if (!branchName) return null

    const CIWorkflow = branchName === 'main' ? 'Pipeline' : 'Deploy CI Environment'

    const ghRunListResult = await $.process.run(
      [
        'gh',
        'run',
        'list',
        '--branch',
        branchName,
        '--workflow',
        CIWorkflow,
        '-L',
        '1',
        '--json',
        'databaseId,status,conclusion',
      ],
      options
    )

    if (ghRunListResult.exitCode !== 0) {
      return { branch: branchName, error: ghRunListResult.stderr.trim() }
    }

    const [latestRun]: { databaseId: number; status: string; conclusion: string }[] = JSON.parse(
      ghRunListResult.stdout
    )

    if (!latestRun) return { branch: branchName }

    const { status, conclusion } = latestRun

    if (status === 'completed' && !FAILING_CONCLUSIONS.has(conclusion)) {
      return { branch: branchName, status, conclusion }
    }

    const ghRunViewResult = await $.process.run(
      ['gh', 'run', 'view', String(latestRun.databaseId), '--json', 'jobs'],
      options
    )

    const { jobs }: { jobs: (Step & { steps?: Step[] })[] } =
      ghRunViewResult.exitCode === 0 ? JSON.parse(ghRunViewResult.stdout) : { jobs: [] }

    const job = jobs.find(
      job => job.status === 'in_progress' || FAILING_CONCLUSIONS.has(job.conclusion)
    )
    const step = job?.steps?.find(
      step => step.status === 'in_progress' || FAILING_CONCLUSIONS.has(step.conclusion)
    )

    return {
      branch: branchName,
      status,
      conclusion,
      detail: [job?.name, step?.name].filter(Boolean).join(' › '),
    }
  } catch (error) {
    $.ui.toast(`GitHub poll failed: ${error instanceof Error ? error.message : error}`)
    return shown
  }
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
