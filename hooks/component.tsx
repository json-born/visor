import type { ClientModule } from 'claude-code'

import type { GithubActionsStatus, SessionInfo } from '../types'

export const FAILING_CONCLUSIONS = new Set(['failure', 'timed_out', 'startup_failure'])

const FRAME_MS = 80
const PROGRESS_CELLS = 10

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
  actions: GithubActionsStatus | null
  now: number | null
  theme: ThemeName
}

type Span = [text: string, colour?: string]

const Visor: ClientModule<Props, { frame: number }> = (props, surface) => {
  const { Box, Text } = surface.elements

  if (surface.state === undefined) {
    surface.setState({ frame: 0 })
    surface.every(FRAME_MS, () => surface.setState({ frame: (surface.state?.frame ?? 0) + 1 }))
  }

  const colour = THEMES[props.theme]
  const sections = buildSections(props, surface.state?.frame ?? 0)
  const lines = wrapSections(sections, surface.columns, [' | ', colour.comment])

  return (
    <Box flexDirection="column" paddingTop={1}>
      <Text color={colour.dark}>{'─'.repeat(surface.columns)}</Text>
      {lines.map(line => (
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
  const { contextPercent } = props

  const contextColour =
    contextPercent === null || contextPercent < 50
      ? colour.green
      : contextPercent < 80
        ? colour.yellow
        : colour.red
  const filledCells =
    contextPercent === null ? 0 : Math.round((contextPercent * PROGRESS_CELLS) / 100)

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
    contextPercent !== null
      ? [
          [`${ICON.context}  `, colour.comment],
          ['█'.repeat(filledCells), contextColour],
          ['░'.repeat(PROGRESS_CELLS - filledCells), colour.dark],
          [` ${contextPercent}%`, contextColour],
        ]
      : [],
    [
      [`${ICON.clock}  `, colour.comment],
      [sessionTime, colour.muted],
      ...(props.added || props.removed
        ? ([
            [` +${props.added}`, colour.green],
            ['/', colour.comment],
            [`-${props.removed}`, colour.red],
          ] as Span[])
        : []),
    ],
    props.actions
      ? [
          [`${ICON.actions}  `, colour.comment],
          ...buildActionsSpans(props.actions, props.branch, frame, colour),
        ]
      : [],
  ]

  return sections.filter(section => section.length > 0)
}

const buildActionsSpans = (
  actions: GithubActionsStatus,
  branch: string,
  frame: number,
  colour: Theme
): Span[] => {
  const spinner = SPINNER_FRAMES[frame % SPINNER_FRAMES.length] ?? ''
  const { status, conclusion = '', detail } = actions

  if (actions.branch !== branch) return [[`${spinner} checking…`, colour.comment]]

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
