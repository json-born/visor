import type { ClientModule } from 'claude-code'

import type { GithubActionsStatus, SessionInfo } from '../types'

export const FAILING_CONCLUSIONS = new Set(['failure', 'timed_out', 'startup_failure'])

const FRAME_MS = 80
const PROGRESS_CELLS = 10

const COLOUR = {
  fg: '#c0caf5',
  muted: '#a9b1d6',
  comment: '#565f89',
  dark: '#3b4261',
  green: '#9ece6a',
  yellow: '#e0af68',
  red: '#f7768e',
}

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

const SPINNER_FRAMES = [...'⠁⠂⠄⡀⡈⡐⡠⣀⣁⣂⣄⣌⣔⣤⣥⣦⣮⣶⣷⣿⡿⠿⢟⠟⡛⠛⠫⢋⠋⠍⡉⠉⠑⠡⢁']

const SEPARATOR: Span = [' | ', COLOUR.comment]

type Props = SessionInfo & { actions: GithubActionsStatus | null; now: number | null }

type Span = [text: string, colour?: string]

const Visor: ClientModule<Props, { frame: number }> = (props, surface) => {
  const { Box, Text } = surface.elements

  if (surface.state === undefined) {
    surface.setState({ frame: 0 })
    surface.every(FRAME_MS, () => surface.setState({ frame: (surface.state?.frame ?? 0) + 1 }))
  }

  const lines = wrapSections(buildSections(props, surface.state?.frame ?? 0), surface.columns)

  return (
    <Box flexDirection="column" paddingTop={1}>
      <Text color={COLOUR.dark}>{'─'.repeat(surface.columns)}</Text>
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
  const { contextPercent } = props

  const contextColour =
    contextPercent === null || contextPercent < 50
      ? COLOUR.green
      : contextPercent < 80
        ? COLOUR.yellow
        : COLOUR.red
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
          [`${ICON.branch}  `, COLOUR.comment],
          [props.branch, COLOUR.fg],
        ]
      : [],
    [
      [`${ICON.model}  `, COLOUR.comment],
      [props.model, COLOUR.muted],
    ],
    contextPercent !== null
      ? [
          [`${ICON.context}  `, COLOUR.comment],
          ['█'.repeat(filledCells), contextColour],
          ['░'.repeat(PROGRESS_CELLS - filledCells), COLOUR.dark],
          [` ${contextPercent}%`, contextColour],
        ]
      : [],
    [
      [`${ICON.clock}  `, COLOUR.comment],
      [sessionTime, COLOUR.muted],
      ...(props.added || props.removed
        ? ([
            [` +${props.added}`, COLOUR.green],
            ['/', COLOUR.comment],
            [`-${props.removed}`, COLOUR.red],
          ] as Span[])
        : []),
    ],
    props.actions
      ? [
          [`${ICON.actions}  `, COLOUR.comment],
          ...buildActionsSpans(props.actions, props.branch, frame),
        ]
      : [],
  ]

  return sections.filter(section => section.length > 0)
}

const buildActionsSpans = (actions: GithubActionsStatus, branch: string, frame: number): Span[] => {
  const spinner = SPINNER_FRAMES[frame % SPINNER_FRAMES.length] ?? ''
  const { status, conclusion = '', detail } = actions

  if (actions.branch !== branch) return [[`${spinner} checking…`, COLOUR.comment]]

  if (!status) return [[`${ICON.none} no runs`, COLOUR.muted]]

  if (status === 'in_progress') {
    return [
      [spinner, COLOUR.fg],
      [` ${detail || 'running'}`, COLOUR.comment],
    ]
  }

  if (status !== 'completed') {
    const isBlinkOn = Math.floor((frame * FRAME_MS) / 500) % 2 === 0

    return [
      [ICON.queued, isBlinkOn ? COLOUR.yellow : COLOUR.dark],
      [' queued', COLOUR.muted],
    ]
  }

  if (FAILING_CONCLUSIONS.has(conclusion)) {
    return [
      [`${ICON.fail} failed`, COLOUR.red],
      ...(detail ? ([[` › ${detail}`, COLOUR.red]] as Span[]) : []),
    ]
  }

  if (conclusion === 'cancelled') return [[`${ICON.ban} cancelled`, COLOUR.comment]]

  return [
    [ICON.check, COLOUR.green],
    [' passed', COLOUR.muted],
  ]
}

export const wrapSections = (sections: Span[][], columns: number): Span[][] => {
  const width = (spans: Span[]) => spans.reduce((total, [text]) => total + [...text].length, 0)
  const lines: Span[][] = []

  for (const section of sections) {
    const lastLine = lines.at(-1)

    if (
      lastLine &&
      (columns <= 0 || width(lastLine) + width([SEPARATOR]) + width(section) <= columns)
    ) {
      lastLine.push(SEPARATOR, ...section)
    } else {
      lines.push([...section])
    }
  }

  return lines
}
