import { expect, test } from 'claude-code/testing'

import type { GithubActionsStatus } from '../types'
import { buildSections, wrapSections } from './component'

const BRANCH = 'feat/teardown-teams-alert'

const props = {
  branch: BRANCH,
  model: 'Opus 5.5',
  contextPercent: 42 as number | null,
  sessionStartedAt: 0,
  now: 104 * 60_000 as number | null,
  theme: 'Tokyo Night' as const,
  added: 12,
  removed: 3,
  actions: {
    branch: BRANCH,
    status: 'completed',
    conclusion: 'failure',
    detail: 'terraform apply',
  } as GithubActionsStatus | null,
}

const render = (overrides: Partial<typeof props> = {}, columns = 0) =>
  wrapSections(buildSections({ ...props, ...overrides }, 0), columns, [' | ', '']).map(line =>
    line.map(([text]) => text).join('')
  )

test('status line collapses cleanly as it narrows', () => {
  const [wide] = render()

  for (const columns of [100, 70, 50, 40, 30]) {
    const narrow = render({}, columns)

    expect(narrow.length > 1).toBe(true)
    expect(narrow.join(' | ')).toBe(wide)
    expect(narrow.every(line => [...line].length <= columns)).toBe(true)
  }
})

test('renders correctly', () => {
  expect(render()).toEqual([
    `\ue725  ${BRANCH} | \uf2db  Opus 5.5 | \uf1c0  ████░░░░░░ 42% | \uf017  1h44m +12/-3 | \uf52e  \uf057 failed › terraform apply`,
  ])
})

test('renders the initial state correctly', () => {
  expect(
    render({ branch: '', contextPercent: null, now: null, added: 0, removed: 0, actions: null })
  ).toEqual([
    `\uf2db  Opus 5.5 | \uf1c0  ░░░░░░░░░░ 0% | \uf017  0m +0/-0`,
  ])
})

test('renders each CI state correctly', () => {
  const ci = (actions: Omit<GithubActionsStatus, 'branch'>, branch = BRANCH) =>
    render({ actions: { branch, ...actions } })[0]?.split('\uf52e  ')[1]

  expect([
    ci({}),
    ci({ error: 'could not find any workflows named Pipeline' }),
    ci({ status: 'queued' }),
    ci({ status: 'in_progress' }),
    ci({ status: 'in_progress', detail: 'deploy › tf apply' }),
    ci({ status: 'completed', conclusion: 'failure', detail: 'test › unit tests' }),
    ci({ status: 'completed', conclusion: 'cancelled' }),
    ci({ status: 'completed', conclusion: 'success' }),
    ci({ status: 'completed', conclusion: 'success' }, 'main'),
  ]).toEqual([
    '\uf10c no runs',
    '\uf10c no runs',
    '\uf252 queued',
    '⠁ running',
    '⠁ deploy › tf apply',
    '\uf057 failed › test › unit tests',
    '\uf05e cancelled',
    '\uf058 passed',
    '⠁ checking…',
  ])
})

test('draws in the chosen theme', () => {
  const branchColour = (theme: typeof props.theme | 'Catppuccin Mocha') =>
    buildSections({ ...props, theme }, 0)[0]?.[1]?.[1]

  expect([branchColour('Tokyo Night'), branchColour('Catppuccin Mocha')]).toEqual([
    '#c0caf5',
    '#cdd6f4',
  ])
})
