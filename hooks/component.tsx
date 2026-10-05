import type { ClientModule } from 'claude-code'

import type { CIRun, CIRuns, SessionInfo } from '../types'

export const FAILING_CONCLUSIONS = new Set(['failure', 'timed_out', 'startup_failure'])

const FRAME_MS = 80
const PROGRESS_CELLS = 10
// The blank row above the rule, then the rule itself, sit above the first line.
const ROWS_ABOVE_LINES = 2

type Theme = Record<'fg' | 'muted' | 'comment' | 'dark' | 'green' | 'yellow' | 'red', string>

const THEMES = {
  'Tokyo Night': {
    fg: '#c0caf5',
    muted: '#a9b1d6',
    comment: '#565f89',
    dark: '#3b4261',
    green: '#9ece6a',
    yellow: '#e0af68',
    red: '#f7768e',
  },
  'Catppuccin Mocha': {
    fg: '#cdd6f4',
    muted: '#bac2de',
    comment: '#6c7086',
    dark: '#45475a',
    green: '#a6e3a1',
    yellow: '#f9e2af',
    red: '#f38ba8',
  },
} satisfies Record<string, Theme>

export type ThemeName = keyof typeof THEMES

const ICON = {
  actions: '\uf52e',
  branch: '\ue725',
  model: '\uf2db',
  context: '\uf1c0',
  clock: '\uf017',
  check: '\uf058',
  fail: '\uf057',
  ban: '\uf05e',
  queued: '\uf252',
  none: '\uf10c',
}

const SPINNER_FRAMES = [...'⠁⠂⠄⠌⠔⠤⠥⠦⠮⠶⠷⠿⠟⠛⠫⠋⠍⠉⠑⠡']

type Props = SessionInfo & {
  ci: CIRuns | null
  expanded: boolean
  now: number | null
  theme: ThemeName
}

type Span = [text: string, colour?: string]

type Segment = { line: number; from: number; to: number }

// Where the CI segment was last drawn, for the pointer listener set up on the first draw.
let ciSegment: Segment | undefined

const Visor: ClientModule<Props, { frame: number }> = (props, surface) => {
  const { Box, Text } = surface.elements

  if (surface.state === undefined) {
    surface.setState({ frame: 0 })
    surface.every(FRAME_MS, () => surface.setState({ frame: (surface.state?.frame ?? 0) + 1 }))
    surface.onPointer(event => {
      const segment = ciSegment

      if (
        event.type === 'down' &&
        segment &&
        event.y === segment.line + ROWS_ABOVE_LINES &&
        event.x >= segment.from &&
        event.x < segment.to
      ) {
        surface.post({ toggle: 'ci' })
      }
    })
  }

  const colour = THEMES[props.theme]
  const frame = surface.state?.frame ?? 0
  const sections = buildSections(props, frame)
  const lines = wrapSections(sections, surface.columns, [' | ', colour.comment])
  ciSegment = findCISegment(lines)
  const rows =
    props.expanded && props.ci?.others.length
      ? buildRows(props.ci, props.now, frame, colour, surface.columns)
      : []

  return (
    <Box flexDirection="column" paddingTop={1}>
      <Text color={colour.dark}>{'─'.repeat(surface.columns)}</Text>
      {[...lines, ...rows].map(line => (
        <Text>
          {line.map(([text, colour]) => (
            <Text color={colour}>{text}</Text>
          ))}
        </Text>
      ))}
    </Box>
  )
}

export default Visor

export const buildSections = (props: Props, frame: number): Span[][] => {
  const colour = THEMES[props.theme]
  const contextPercent = props.contextPercent ?? 0

  const contextColour =
    contextPercent < 50 ? colour.green : contextPercent < 80 ? colour.yellow : colour.red
  const filledCells = Math.round((contextPercent * PROGRESS_CELLS) / 100)

  const elapsedMs = (props.now ?? props.sessionStartedAt) - props.sessionStartedAt
  const minutes = Math.max(0, Math.floor(elapsedMs / 60_000))
  const sessionTime =
    minutes >= 60
      ? `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}m`
      : `${minutes}m`

  const sections: Span[][] = [
    props.branch
      ? [
          [`${ICON.branch}  `, colour.comment],
          [props.branch, colour.fg],
        ]
      : [],
    [
      [`${ICON.model}  `, colour.comment],
      [props.model, colour.muted],
    ],
    [
      [`${ICON.context}  `, colour.comment],
      ['█'.repeat(filledCells), contextColour],
      ['░'.repeat(PROGRESS_CELLS - filledCells), colour.dark],
      [` ${contextPercent}%`, contextColour],
    ],
    [
      [`${ICON.clock}  `, colour.comment],
      [sessionTime, colour.muted],
      [` +${props.added}`, colour.green],
      ['/', colour.comment],
      [`-${props.removed}`, colour.red],
    ],
    props.ci
      ? [
          [`${ICON.actions}  `, colour.comment],
          ...buildRunSpans(props.ci.current, props.branch, frame, colour),
          ...buildBadge(props.ci.others.length, props.expanded, colour),
        ]
      : [],
  ]

  return sections.filter(section => section.length > 0)
}

const buildRunSpans = (run: CIRun, branch: string, frame: number, colour: Theme): Span[] => {
  const spinner = SPINNER_FRAMES[frame % SPINNER_FRAMES.length] ?? ''
  const { status, conclusion = '', detail } = run

  if (run.branch !== branch) return [[`${spinner} checking…`, colour.comment]]

  if (!status) return [[`${ICON.none} no runs`, colour.muted]]

  if (status === 'in_progress') {
    return [
      [spinner, colour.fg],
      [` ${detail || 'running'}`, colour.comment],
    ]
  }

  if (status !== 'completed') {
    const isBlinkOn = Math.floor((frame * FRAME_MS) / 500) % 2 === 0

    return [
      [ICON.queued, isBlinkOn ? colour.yellow : colour.dark],
      [' queued', colour.muted],
    ]
  }

  if (FAILING_CONCLUSIONS.has(conclusion)) {
    return [
      [`${ICON.fail} failed`, colour.red],
      ...(detail ? ([[` › ${detail}`, colour.red]] as Span[]) : []),
    ]
  }

  if (conclusion === 'cancelled') return [[`${ICON.ban} cancelled`, colour.comment]]

  return [
    [ICON.check, colour.green],
    [' passed', colour.muted],
  ]
}

const buildBadge = (count: number, expanded: boolean, colour: Theme): Span[] =>
  count > 0 ? [[`  ${expanded ? '▾' : '▸'} ${count}`, colour.comment]] : []

const spanWidth = (spans: Span[]) => spans.reduce((total, [text]) => total + [...text].length, 0)

const pad = (text: string, width: number) =>
  text + ' '.repeat(Math.max(0, width - [...text].length))

const truncate = (spans: Span[], columns: number): Span[] => {
  if (columns <= 0 || spanWidth(spans) <= columns) return spans

  const kept: Span[] = []
  let room = columns - 1

  for (const [text, colour] of spans) {
    const chars = [...text]

    if (chars.length >= room) {
      kept.push([`${chars.slice(0, room).join('')}…`, colour])
      return kept
    }

    kept.push([text, colour])
    room -= chars.length
  }

  return kept
}

export const formatAge = (ms: number) => {
  const minutes = Math.max(0, Math.floor(ms / 60_000))

  if (minutes >= 24 * 60) return `${Math.floor(minutes / (24 * 60))}d`
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h`

  return `${minutes}m`
}

// The current branch first, then the user's other branches.
export const buildRows = (
  ci: CIRuns,
  now: number | null,
  frame: number,
  colour: Theme,
  columns: number
): Span[][] => {
  const runs = [ci.current, ...ci.others]
  const state = (run: CIRun) => buildRunSpans(run, run.branch, frame, colour)
  const branchWidth = Math.max(...runs.map(run => [...run.branch].length))
  const workflowWidth = Math.max(...runs.map(run => [...(run.workflow ?? '')].length))
  const stateWidth = Math.max(...runs.map(run => spanWidth(state(run))))

  return runs.map((run, index) => {
    const spans = state(run)
    const age = now !== null && run.updatedAt !== undefined ? formatAge(now - run.updatedAt) : ''

    return truncate(
      [
        [index === 0 ? '   ● ' : '     ', colour.comment],
        [pad(run.branch, branchWidth), index === 0 ? colour.fg : colour.muted],
        ['  ', undefined],
        [pad(run.workflow ?? '', workflowWidth), colour.comment],
        ['  ', undefined],
        ...spans,
        [' '.repeat(stateWidth - spanWidth(spans)), undefined],
        [`  ${age}`, colour.comment],
      ],
      columns
    )
  })
}

// Where the CI segment sits in the wrapped lines, so a click on it can be told from one elsewhere.
export const findCISegment = (lines: Span[][]): Segment | undefined => {
  for (const [line, spans] of lines.entries()) {
    const start = spans.findIndex(([text]) => text === `${ICON.actions}  `)

    if (start !== -1) {
      const from = spanWidth(spans.slice(0, start))

      return { line, from, to: from + spanWidth(spans.slice(start)) }
    }
  }
}

export const wrapSections = (sections: Span[][], columns: number, separator: Span): Span[][] => {
  const width = (spans: Span[]) => spans.reduce((total, [text]) => total + [...text].length, 0)
  const lines: Span[][] = []

  for (const section of sections) {
    const lastLine = lines.at(-1)

    if (
      lastLine &&
      (columns <= 0 || width(lastLine) + width([separator]) + width(section) <= columns)
    ) {
      lastLine.push(separator, ...section)
    } else {
      lines.push([...section])
    }
  }

  return lines
}
