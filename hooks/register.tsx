import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Bar, Ci } from '../types'
import { displayModel, parseShortstat } from './bar'
import { SETTLED, TRIGGERS, failure, primaryFor, running, summariseRuns } from './ci'
import type { Job } from './ci'

const ci = atom({ plugin: 'my-mods', key: 'ci' } as const, null)
const bar = atom({ plugin: 'my-mods', key: 'bar' } as const, null)

let lastError = ''

const report = ($: EngineInterface, message: string) => {
  if (message !== lastError) $.ui.log(`my-mods: ${message}`)
  lastError = message
}

const sh = async ($: EngineInterface, argv: string[], cwd: string) => {
  const r = await $.process.run(argv, { cwd, timeoutMs: 20_000 })
  if (r.exitCode === 0) return r.stdout.trim()
  report($, `${argv.slice(0, 3).join(' ')} exited ${r.exitCode}: ${r.stderr.trim().slice(0, 200)}`)
  return null
}

const jobsOf = async ($: EngineInterface, id: number, cwd: string): Promise<Job[]> => {
  const out = await sh($, ['gh', 'run', 'view', String(id), '--json', 'jobs'], cwd)
  return out ? JSON.parse(out).jobs : []
}

let lastFetch = 0
let isBusy = false

const poll = async ($: EngineInterface, isForced = false) => {
  if (isBusy) return
  isBusy = true
  try {
    const now = await $.clock.now()
    const prev = await read($, ci)
    const isSettled = prev !== null && SETTLED.has(prev.state) && !prev.sha
    if (!isForced && now - lastFetch < (isSettled ? 60_000 : 4_500)) return
    lastFetch = now

    const cwd = await $.session.cwd()
    const branch = await sh($, ['git', 'branch', '--show-current'], cwd)
    if (!branch) {
      await update($, ci, () => null)
      return
    }
    const head = (await sh($, ['git', 'rev-parse', 'HEAD'], cwd)) ?? ''
    const out = await sh($, ['gh', 'run', 'list', '--branch', branch, '-L', '50', '--json', 'databaseId,name,status,conclusion,headSha,event'], cwd)
    if (out === null) return

    const primary = primaryFor(branch)
    const s = summariseRuns(JSON.parse(out), head, primary)
    let { state, detail } = s
    if (s.activeId) {
      const r = running(await jobsOf($, s.activeId, cwd))
      if (r.detail) detail = r.detail
      if (r.isRunning) state = 'running'
    }
    if (state === 'queued' && s.blockerId) detail = 'waiting for a previous run to complete'
    if (state === 'failed' && s.failedId) detail = failure(await jobsOf($, s.failedId, cwd))

    const next: Ci = { branch, state, sha: s.sha, detail, primary, now }
    await update($, ci, () => next)
  } catch (err) {
    report($, err instanceof Error ? err.message : String(err))
  } finally {
    isBusy = false
  }
}

const refreshBar = async ($: EngineInterface) => {
  try {
    const cwd = await $.session.cwd()
    const [usage, model, branch, diff, now] = await Promise.all([
      $.session.usage(),
      $.session.model(),
      $.process.run(['git', 'branch', '--show-current'], { cwd }),
      $.process.run(['git', 'diff', '--shortstat', 'HEAD'], { cwd }),
      $.clock.now(),
    ])
    const next: Bar = {
      branch: branch.exitCode === 0 ? branch.stdout.trim() : '',
      model: displayModel(model),
      contextPercent: usage.context.percent ?? null,
      sessionStartedAt: usage.startedAt,
      ...(diff.exitCode === 0 ? parseShortstat(diff.stdout) : { added: 0, removed: 0 }),
      now,
    }
    await update($, bar, () => next)
  } catch (err) {
    report($, err instanceof Error ? err.message : String(err))
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await refreshBar($)
    void poll($, true)
    $.clock.every(5_000, () => {
      void poll($)
      void refreshBar($)
    })
    return started
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    await refreshBar($)
    void poll($, true)
    return done
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (TRIGGERS.test(e.command)) void poll($, true)
    return ran
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const hint = await next(e)
    const line = await read($, bar)
    const elements = $.ui.resolve(e)
    const Client = 'Client' in elements ? elements.Client : undefined
    if (line === null || !Client) return hint

    const { Box } = elements
    const status = await read($, ci)

    return (
      <Box flexDirection="column">
        {hint}
        <Client key="statusline" module="./statusline.tsx" width="100%" props={{ ...line, ci: status }} />
      </Box>
    )
  })
}
