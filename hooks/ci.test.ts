import { expect, test } from 'claude-code/testing'

import { TRIGGERS, failure, running, summariseRuns as summarise } from './ci'

const run = (o: Partial<Parameters<typeof summarise>[0][number]>) => ({
  databaseId: 1,
  name: 'Pipeline',
  status: 'completed',
  conclusion: 'success',
  headSha: 'aaaaaaaaa',
  event: 'push',
  ...o,
})

test('ignores dynamic runs and earlier commits', () => {
  const s = summarise(
    [
      run({ event: 'dynamic', conclusion: 'failure', name: 'Dependabot' }),
      run({}),
      run({ headSha: 'bbbbbbbbb', conclusion: 'failure' }),
    ],
    'aaaaaaaaa',
    'Deploy CI Environment',
  )
  expect(s.state).toBe('passed')
  expect(s.sha).toBe('')
})

test('running beats failed', () => {
  const s = summarise(
    [
      run({ databaseId: 2, status: 'in_progress', conclusion: '', name: 'Deploy' }),
      run({ databaseId: 3, status: 'queued', conclusion: '', name: 'Deploy' }),
      run({ databaseId: 4, conclusion: 'failure' }),
    ],
    'ccccccccc',
    'Deploy CI Environment',
  )
  expect(s.state).toBe('running')
  expect(s.activeId).toBe(2)
  expect(s.detail).toBe('Deploy')
  expect(s.sha).toBe('aaaaaaa')
})

test('names the running job and step without the caller prefix', () => {
  const r = running([
    { name: 'Check', status: 'completed', conclusion: 'success' },
    {
      name: 'CI Environment / Deploy (CI Workspace)',
      status: 'in_progress',
      conclusion: '',
      steps: [
        { name: 'Setup', status: 'completed', conclusion: 'success' },
        { name: 'Terraform apply', status: 'in_progress', conclusion: '' },
      ],
    },
    { name: 'Tests', status: 'queued', conclusion: '' },
  ])
  expect(r).toEqual({ isRunning: true, detail: 'Deploy (CI Workspace) › Terraform apply' })
})

test('labels the single running job in a nested workflow', () => {
  const step = (status: string) => ({ name: 's', status, conclusion: '' })
  const r = running([
    { name: 'Classify', status: 'completed', conclusion: 'success' },
    { name: 'CI Environment / Build & Test / Web Application', status: 'completed', conclusion: 'success', steps: [step('completed'), step('completed')] },
    { name: 'CI Environment / Build & Test / Lambdas', status: 'in_progress', conclusion: '', steps: [step('completed'), step('in_progress')] },
    { name: 'CI Environment / Build & Test / AppSync', status: 'queued', conclusion: '' },
    { name: 'CI Environment / Deploy Storybook / Run', status: 'queued', conclusion: '' },
  ])
  expect(r.detail).toBe('Build & Test / Lambdas › s')
  const both = running([
    { name: 'CI Environment / Build & Test / Web Application', status: 'in_progress', conclusion: '', steps: [step('in_progress')] },
    { name: 'CI Environment / Build & Test / Lambdas', status: 'in_progress', conclusion: '', steps: [step('in_progress')] },
  ])
  expect(both.detail).toBe('Build & Test: 2 jobs running')
})

test('names the failing job and step', () => {
  expect(
    failure([
      { name: 'lint', status: 'completed', conclusion: 'success' },
      { name: 'test', status: 'completed', conclusion: 'failure', steps: [{ name: 'Run unit tests', status: 'completed', conclusion: 'failure' }] },
    ]),
  ).toBe('test › Run unit tests')
})

test('keeps similarly named jobs apart and labels nested single jobs', () => {
  const deploys = running([
    { name: 'CI Environment / Deploy (CI Workspace)', status: 'in_progress', conclusion: '' },
    { name: 'CI Environment / Deploy (Workspace)', status: 'in_progress', conclusion: '' },
  ])
  expect(deploys.detail).toBe('Deploy (CI Workspace)')
  const single = running([{ name: 'CI Environment / Deploy Storybook / Run', status: 'in_progress', conclusion: '' }])
  expect(single.detail).toBe('Deploy Storybook / Run')
})

test('names the queued job when nothing is running', () => {
  const r = running([
    { name: 'Check Global Skip', status: 'completed', conclusion: 'success' },
    { name: 'CI Passed', status: 'queued', conclusion: '' },
  ])
  expect(r.detail).toBe('CI Passed')
  expect(r.isRunning).toBe(false)
  expect(summarise([run({ databaseId: 9, status: 'queued', conclusion: '' })], 'aaaaaaaaa', 'Deploy CI Environment').activeId).toBe(9)
})

test('kicks a check after pushes and reruns only', () => {
  expect(['git push -u origin x', 'cd a && git push', 'gh run rerun 123 --failed', 'gh pr create --base main'].every(c => TRIGGERS.test(c))).toBe(true)
  expect(['git pull', 'git status', 'gh run list'].some(c => TRIGGERS.test(c))).toBe(false)
})

const P = 'Deploy CI Environment'

test('primary takes priority over secondary workflows', () => {
  const queued = summarise([run({ databaseId: 1, name: P, status: 'queued', conclusion: '' }), run({ databaseId: 2, name: 'PR Validation', status: 'in_progress', conclusion: '' })], 'aaaaaaaaa', P)
  expect([queued.state, queued.activeId, queued.detail]).toEqual(['queued', 1, P])

  const quiet = summarise([run({ databaseId: 1, name: P, status: 'in_progress', conclusion: '' }), run({ databaseId: 2, name: 'PR Validation', conclusion: 'failure' })], 'aaaaaaaaa', P)
  expect([quiet.state, quiet.activeId]).toEqual(['running', 1])

  const waiting = summarise([run({ name: P }), run({ databaseId: 2, name: 'Spark Review', status: 'in_progress', conclusion: '' })], 'aaaaaaaaa', P)
  expect([waiting.state, waiting.activeId]).toEqual(['running', 2])
})

test('primary failure wins, secondary failures after a primary pass are partial', () => {
  const failed = summarise([run({ databaseId: 1, name: P, conclusion: 'failure' }), run({ databaseId: 2, name: 'PR Validation', conclusion: 'failure' })], 'aaaaaaaaa', P)
  expect([failed.state, failed.failedId]).toEqual(['failed', 1])

  const partial = summarise([run({ name: P }), run({ name: 'PR Validation', conclusion: 'failure' }), run({ name: 'Spark Review', conclusion: 'failure' })], 'aaaaaaaaa', P)
  expect([partial.state, partial.detail]).toEqual(['partial', 'PR Validation, Spark Review'])
})

test('without the primary workflow every run counts the same', () => {
  expect(summarise([run({ name: 'PR Validation', conclusion: 'failure' })], 'aaaaaaaaa', 'Pipeline').state).toBe('failed')
})

test('ignores cancelled runs superseded by a newer run of the same workflow', () => {
  const superseded = summarise([run({ name: P }), run({ name: 'PR Validation' }), run({ name: 'PR Validation', conclusion: 'cancelled' })], 'aaaaaaaaa', P)
  expect(superseded.state).toBe('passed')
  const cancelled = summarise([run({ name: P, conclusion: 'cancelled' }), run({ name: P })], 'aaaaaaaaa', P)
  expect(cancelled.state).toBe('cancelled')
})

test('a queued primary names the older run it is waiting behind', () => {
  const s = summarise(
    [
      run({ databaseId: 2, name: P, status: 'pending', conclusion: '' }),
      run({ databaseId: 1, name: P, status: 'in_progress', conclusion: '', headSha: 'bbbbbbbbb' }),
    ],
    'aaaaaaaaa',
    P,
  )
  expect([s.state, s.activeId, s.blockerId]).toEqual(['queued', 2, 1])
  expect(summarise([run({ name: P })], 'aaaaaaaaa', P).blockerId).toBeUndefined()
})
