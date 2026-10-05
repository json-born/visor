import { expect, test } from 'claude-code/testing'

import type { CIRun, CIRuns } from '../types'
import {
  buildCIRunTable,
  buildHeading,
  buildSections,
  findCISegment,
  formatAge,
  wrapSections,
} from './component'

const BRANCH = 'feat/teardown-teams-alert'

const props = {
  branch: BRANCH,
  model: 'Opus 5.5',
  contextPercent: 42 as number | null,
  sessionStartedAt: 0,
  now: (104 * 60_000) as number | null,
  theme: 'Tokyo Night' as const,
  added: 12,
  removed: 3,
  expanded: false,
  ci: {
    current: {
      branch: BRANCH,
      status: 'completed',
      conclusion: 'failure',
      detail: 'terraform apply',
    },
    others: [],
  } as CIRuns | null,
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
    render({ branch: '', contextPercent: null, now: null, added: 0, removed: 0, ci: null })
  ).toEqual([`\uf2db  Opus 5.5 | \uf1c0  ░░░░░░░░░░ 0% | \uf017  0m +0/-0`])
})

test('renders each CI state correctly', () => {
  const ci = (current: Omit<CIRun, 'branch'>, branch = BRANCH) =>
    render({ ci: { current: { branch, ...current }, others: [] } })[0]?.split('\uf52e  ')[1]

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

const OTHERS: CIRun[] = [
  {
    branch: 'fix/token-refresh',
    workflow: 'CI',
    status: 'completed',
    conclusion: 'failure',
    detail: 'lint › biome check',
    updatedAt: 90 * 60_000,
  },
  { branch: 'chore/deps', workflow: 'CI', status: 'queued', updatedAt: 101 * 60_000 },
  {
    branch: 'main',
    workflow: 'Deploy',
    status: 'completed',
    conclusion: 'success',
    updatedAt: 44 * 60_000,
  },
]

const withOthers = (others: CIRun[]): CIRuns => ({
  current: {
    branch: BRANCH,
    workflow: 'CI',
    status: 'in_progress',
    detail: 'build › unit tests',
    updatedAt: 102 * 60_000,
  },
  others,
})

test('shows ▸ N collapsed, ▾ N expanded, nothing when there are no additional CI runs', () => {
  const badge = (ci: CIRuns, expanded: boolean) => render({ ci, expanded })[0]?.split('\uf52e  ')[1]

  expect([
    badge(withOthers(OTHERS), false),
    badge(withOthers(OTHERS), true),
    badge(withOthers([]), false),
    badge(withOthers([]), true),
  ]).toEqual([
    '⠁ build › unit tests  ▸ 3',
    '⠁ build › unit tests  ▾ 3',
    '⠁ build › unit tests',
    '⠁ build › unit tests',
  ])
})

const COLOURS = { fg: '', muted: '', comment: '', dark: '', green: '', yellow: '', red: '' }

const text = (rows: [string, string?][][]) => rows.map(row => row.map(([text]) => text).join(''))

test('lists the current branch first, then other branches with aligned columns', () => {
  const row = (marker: string, branch: string, workflow: string, state: string, age: string) =>
    `${marker}${branch.padEnd(BRANCH.length)}  ${workflow.padEnd(6)}  ${state.padEnd(29)}  ${age}`

  expect(text(buildCIRunTable(withOthers(OTHERS), props.now, 0, COLOURS, 0))).toEqual([
    row('     ', BRANCH, 'CI', '⠁ build › unit tests', '2m'),
    row('     ', 'fix/token-refresh', 'CI', '\uf057 failed › lint › biome check', '14m'),
    row('     ', 'chore/deps', 'CI', '\uf252 queued', '3m'),
    row('     ', 'main', 'Deploy', '\uf058 passed', '1h'),
  ])
})

test('truncates expanded rows to fit the width', () => {
  const rows = text(buildCIRunTable(withOthers(OTHERS), props.now, 0, COLOURS, 40))

  expect(rows.every(row => [...row].length <= 40)).toBe(true)
  expect(rows.every(row => row.endsWith('…'))).toBe(true)
})

test('formats ages as minutes, hours and days', () => {
  expect(
    [0, 59_000, 5 * 60_000, 60 * 60_000, 150 * 60_000, 25 * 60 * 60_000, 72 * 60 * 60_000].map(
      formatAge
    )
  ).toEqual(['0m', '0m', '5m', '1h', '2h', '1d', '3d'])
})

test('finds where the CI segment sits on its line', () => {
  const lines = wrapSections(buildSections({ ...props, ci: withOthers(OTHERS) }, 0), 0, [' | ', ''])
  const [line] = lines
  const width = [...(line?.map(([text]) => text).join('') ?? '')].length
  const segment = findCISegment(lines)

  expect(segment?.line).toBe(0)
  expect(segment?.to).toBe(width)
  expect(segment && segment.from > 0 && segment.from < segment.to).toBe(true)
  expect(
    findCISegment(wrapSections(buildSections({ ...props, ci: null }, 0), 0, [' | ', '']))
  ).toBeUndefined()
})

test('titles the expanded view with a rule across the rest of the width', () => {
  expect(text(buildHeading(COLOURS, 20))).toEqual([' ', `   CI runs ${'─'.repeat(9)}`])
  expect(text(buildHeading(COLOURS, 0))).toEqual([' ', '   CI runs '])
})
