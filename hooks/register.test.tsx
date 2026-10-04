import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { formatModelName, POLL_TRIGGER_COMMANDS, parseShortstat } from './register'

const GIT_STDOUT = { 'git branch': 'feat/x', 'git rev-parse': 'aaaaaaaaa', 'git diff': '' }

const PROMPT_HINT = {
  plugin: 'visor',
  surface: 'terminal',
  component: 'PromptHint',
  props: { isDraft: false, isWorking: false, hint: '' },
} as const

const SESSION_START = { cwd: '/repo', surface: 'terminal', isInteractive: true } as const

const run = (fields: object) => ({
  databaseId: 1,
  name: 'Deploy CI Environment',
  status: 'completed',
  conclusion: 'success',
  headSha: 'aaaaaaaaa',
  event: 'push',
  ...fields,
})

const mockEngine = (
  on: On,
  stdoutByCommand: Record<string, string | null>,
  holdRunList = false
) => {
  const commands: string[] = []
  const toasts: string[] = []
  const clock = mock.clock(on, { now: 100_000 })
  let releaseRunList = () => {}
  const runListGate = holdRunList
    ? new Promise<void>(resolve => {
        releaseRunList = resolve
      })
    : Promise.resolve()

  mock.store(on)
  on('session.start', async () => ({ cwd: '/repo' }))
  on('session.cwd', async () => ({ value: '/repo' }))
  on('session.model', async () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', async () => ({
    value: { startedAt: 100_000, context: { window: 200_000, percent: 42 }, rateLimits: [] },
  }))
  on('ui.render', { component: 'PromptHint' }, async ($, event) => {
    const { Text } = $.ui.resolve(event)
    return <Text>hint</Text>
  })
  on('ui.toast', async (_$, event) => {
    toasts.push(event.text)
    return { value: undefined }
  })
  on('process.run', async (_$, event) => {
    const line = event.argv.join(' ')
    commands.push(line)

    if (line.startsWith('gh run list')) await runListGate

    const key = Object.keys(stdoutByCommand).find(prefix => line.startsWith(prefix))
    const stdout = key === undefined ? null : (stdoutByCommand[key] ?? null)

    return {
      value: {
        exitCode: stdout === null ? 1 : 0,
        stdout: stdout ?? '',
        stderr: stdout === null ? 'failed' : '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    }
  })

  const runListCalls = () => commands.filter(line => line.startsWith('gh run list')).length

  return { commands, toasts, clock, releaseRunList, runListCalls }
}

const statusText = async (ui: { findAll: (query: object) => Promise<{ text: string }[]> }) =>
  (await ui.findAll({ type: 'Text', in: 'visor' })).map(element => element.text).join('')

test('shows the CI status once the first fetch lands', async ($, on) => {
  const mocks = mockEngine(on, { ...GIT_STDOUT, 'gh run list': JSON.stringify([run({})]) }, true)

  await $.session.start(SESSION_START)
  const ui = await $.ui.mount(PROMPT_HINT)
  expect(await statusText(ui)).not.toMatch(/passed/)

  mocks.releaseRunList()
  await mocks.clock.settle()
  expect(await statusText(ui)).toMatch(/passed/)
  expect(mocks.commands.some(line => line.includes('--workflow Deploy CI Environment'))).toBe(true)
})

test('names the running job and step', async ($, on) => {
  const jobs = [
    { name: 'lint', status: 'completed', conclusion: 'success' },
    {
      name: 'deploy',
      status: 'in_progress',
      conclusion: '',
      steps: [
        { name: 'checkout', status: 'completed', conclusion: 'success' },
        { name: 'tf apply', status: 'in_progress', conclusion: '' },
      ],
    },
  ]
  const mocks = mockEngine(on, {
    ...GIT_STDOUT,
    'gh run list': JSON.stringify([run({ databaseId: 7, status: 'in_progress', conclusion: '' })]),
    'gh run view 7': JSON.stringify({ jobs }),
  })

  await $.session.start(SESSION_START)
  await mocks.clock.settle()
  const ui = await $.ui.mount(PROMPT_HINT)

  expect(await statusText(ui)).toMatch(/deploy › tf apply/)
})

test('names the failing job and step', async ($, on) => {
  const jobs = [
    {
      name: 'test',
      status: 'completed',
      conclusion: 'failure',
      steps: [{ name: 'unit tests', status: 'completed', conclusion: 'failure' }],
    },
  ]
  const mocks = mockEngine(on, {
    ...GIT_STDOUT,
    'gh run list': JSON.stringify([run({ databaseId: 9, conclusion: 'failure' })]),
    'gh run view 9': JSON.stringify({ jobs }),
  })

  await $.session.start(SESSION_START)
  await mocks.clock.settle()
  const ui = await $.ui.mount(PROMPT_HINT)

  expect(await statusText(ui)).toMatch(/failed › test › unit tests/)
})

test('shows no runs when gh cannot list them', async ($, on) => {
  const mocks = mockEngine(on, { ...GIT_STDOUT, 'gh run list': null })

  await $.session.start(SESSION_START)
  await mocks.clock.settle()
  const ui = await $.ui.mount(PROMPT_HINT)

  expect(await statusText(ui)).toMatch(/\uf10c no runs/)
  expect(mocks.toasts).toEqual([])
})

test('does not ask GitHub outside a branch', async ($, on) => {
  const mocks = mockEngine(on, { 'git branch': '', 'git diff': '' })

  await $.session.start(SESSION_START)
  await mocks.clock.settle()

  expect(mocks.runListCalls()).toBe(0)
})

test('polls a settled result once a minute', async ($, on) => {
  const mocks = mockEngine(on, { ...GIT_STDOUT, 'gh run list': JSON.stringify([run({})]) })

  await $.session.start(SESSION_START)
  await mocks.clock.settle()
  expect(mocks.runListCalls()).toBe(1)

  await mocks.clock.advance(5_000)
  expect(mocks.runListCalls()).toBe(1)

  await mocks.clock.advance(55_000)
  expect(mocks.runListCalls()).toBe(2)
})

test('a poll already in flight makes the next one a no-op', async ($, on) => {
  const mocks = mockEngine(
    on,
    { ...GIT_STDOUT, 'gh run list': JSON.stringify([run({ status: 'queued', conclusion: '' })]) },
    true
  )

  await $.session.start(SESSION_START)
  await mocks.clock.advance(5_000)
  expect(mocks.runListCalls()).toBe(1)

  mocks.releaseRunList()
  await mocks.clock.settle()
})

test('polls once and goes quiet when there is nothing to find', async ($, on) => {
  const mocks = mockEngine(on, { ...GIT_STDOUT, 'gh run list': null })

  await $.session.start(SESSION_START)
  await mocks.clock.settle()
  expect(mocks.runListCalls()).toBe(1)

  await mocks.clock.advance(5_000)
  expect(mocks.runListCalls()).toBe(1)

  await mocks.clock.advance(55_000)
  expect(mocks.runListCalls()).toBe(2)
})

test('a push wakes the poll and polls fast for a while', async ($, on) => {
  const mocks = mockEngine(on, { ...GIT_STDOUT, 'gh run list': JSON.stringify([run({})]) })
  on('tool.call', { tool: 'Bash' }, async () => ({ deny: 'not run in tests' }))

  await $.session.start(SESSION_START)
  await mocks.clock.settle()
  expect(mocks.runListCalls()).toBe(1)

  await $.tool.call({ tool: 'Bash', command: 'git push' })
  await mocks.clock.settle()
  expect(mocks.runListCalls()).toBe(2)

  await mocks.clock.advance(5_000)
  expect(mocks.runListCalls()).toBe(3)
})

test('reads git shortstat', () => {
  expect(parseShortstat(' 3 files changed, 678 insertions(+), 222 deletions(-)')).toEqual({
    added: 678,
    removed: 222,
  })
  expect(parseShortstat(' 1 file changed, 1 insertion(+)')).toEqual({ added: 1, removed: 0 })
  expect(parseShortstat('')).toEqual({ added: 0, removed: 0 })
})

test('formats model ids as readable names', () => {
  expect(
    [
      'claude-opus-5-5',
      'claude-sonnet-5-5[1m]',
      'claude-haiku-4-5-20251001',
      'Opus 5.5',
      'custom-model',
    ].map(formatModelName)
  ).toEqual(['Opus 5.5', 'Sonnet 5.5', 'Haiku 4.5', 'Opus 5.5', 'custom-model'])
})

test('kicks a check after pushes and reruns only', () => {
  expect(
    [
      'git push -u origin x',
      'cd a && git push',
      'gh run rerun 123 --failed',
      'gh pr create --base main',
    ].every(c => POLL_TRIGGER_COMMANDS.test(c))
  ).toBe(true)
  expect(['git pull', 'git status', 'gh run list'].some(c => POLL_TRIGGER_COMMANDS.test(c))).toBe(
    false
  )
})

test('shows a toast when gh answers something unreadable', async ($, on) => {
  const mocks = mockEngine(on, { ...GIT_STDOUT, 'gh run list': 'not json' })

  await $.session.start(SESSION_START)
  await mocks.clock.settle()

  expect(mocks.toasts.length).toBe(1)
  expect(mocks.toasts[0]).toMatch(/^GitHub poll failed: /)
})
