import type { ClientModule } from 'claude-code'

import type { Bar, Ci } from '../types'

type Props = Bar & { ci: Ci | null }
type Anchor = { startedAt: number; now: number; base: number; f0: number }
type Frame = { f: number; session?: Anchor }
type Run = [text: string, colour?: string]

const T = {
  fg: '#c0caf5',
  muted: '#a9b1d6',
  comment: '#565f89',
  dark: '#3b4261',
  green: '#9ece6a',
  yellow: '#e0af68',
  red: '#f7768e',
}
const SPIN = ['⠁', '⠂', '⠄', '⡀', '⡈', '⡐', '⡠', '⣀', '⣁', '⣂', '⣄', '⣌', '⣔', '⣤', '⣥', '⣦', '⣮', '⣶', '⣷', '⣿', '⡿', '⠿', '⢟', '⠟', '⡛', '⠛', '⠫', '⢋', '⠋', '⠍', '⡉', '⠉', '⠑', '⠡', '⢁']
const TICK = 80
const SEP: Run = [' | ', T.comment]
const I = {
  ci: '\uf52e',
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

export const sessionTime = (ms: number) => {
  const m = Math.max(0, Math.floor(ms / 60_000))
  return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m` : `${m}m`
}

export const reanchor = (a: Anchor | undefined, startedAt: number, now: number, f: number): Anchor => {
  if (a && a.startedAt === startedAt && a.now === now) return a
  const truth = now - startedAt
  const isClose = a !== undefined && a.startedAt === startedAt && Math.abs(shown(a, f) - truth) <= 2_000
  return isClose ? { ...a, now } : { startedAt, now, base: truth, f0: f }
}

export const shown = (a: Anchor, f: number) => a.base + (f - a.f0) * TICK

export const contextColour = (pct: number) => (pct >= 80 ? T.red : pct >= 50 ? T.yellow : T.green)

export const cells = (rs: Run[]) => rs.reduce((n, [t]) => n + [...t].length, 0)

export const pack = (sections: Run[][], columns: number): Run[][] => {
  const lines: Run[][] = []
  for (const s of sections) {
    const last = lines.at(-1)
    if (last && (columns <= 0 || cells(last) + cells([SEP]) + cells(s) <= columns)) last.push(SEP, ...s)
    else lines.push([...s])
  }
  return lines
}

const ciRuns = (ci: Ci, f: number): Run[] => {
  const spin = SPIN[f % SPIN.length] ?? ''
  const d = ci.detail
  switch (ci.state) {
    case 'running':
      return [[spin, T.fg], ...(d ? [[` ${d}`, T.comment] as Run] : [])]
    case 'queued':
      return [[I.queued, Math.floor((f * TICK) / 500) % 2 === 0 ? T.yellow : T.dark], [' queued', T.muted], ...(d ? [[`  ${d}`, T.comment] as Run] : [])]
    case 'failed':
      return [[`${I.fail} failed`, T.red], ...(d ? [[' › ', T.comment], [d, T.red]] as Run[] : [])]
    case 'partial':
      return [[I.check, T.green], [` ${ci.primary} passed  `, T.muted], [`${I.fail} ${d} failed`, T.red]]
    case 'passed':
      return [[I.check, T.green], [' passed', T.muted]]
    case 'cancelled':
      return [[`${I.ban} cancelled`, T.comment]]
    case 'checking':
      return [[`${spin} checking…`, T.comment]]
    default:
      return [[`${I.none} no runs`, T.comment]]
  }
}

export const sections = (p: Props, f: number, elapsedMs: number): Run[][] => {
  const pct = p.contextPercent
  const filled = pct === null ? 0 : Math.round(pct / 10)
  const diff: Run[] = p.added || p.removed ? [[' ', undefined], [`+${p.added}`, T.green], ['/', T.comment], [`-${p.removed}`, T.red]] : []
  const all: Run[][] = [
    p.branch ? [[`${I.branch}  `, T.comment], [p.branch, T.fg]] : [],
    [[`${I.model}  `, T.comment], [p.model, T.muted]],
    pct !== null ? [[`${I.context}  `, T.comment], ['█'.repeat(filled), contextColour(pct)], ['░'.repeat(10 - filled), T.dark], [` ${pct}%`, contextColour(pct)]] : [],
    [[`${I.clock}  `, T.comment], [sessionTime(elapsedMs), T.comment], ...diff],
    p.ci ? [[`${I.ci}  `, T.comment], ...ciRuns(p.ci, f)] : [],
  ]
  return all.filter(s => s.length > 0)
}

const Statusline: ClientModule<Props, Frame> = (p, surface) => {
  const { Box, Text } = surface.elements
  let frame = surface.state
  if (frame === undefined) {
    frame = { f: 0 }
    surface.every(TICK, () => {
      const s = surface.state ?? { f: 0 }
      surface.setState({ ...s, f: s.f + 1 })
    })
  }
  const { f } = frame
  const session = reanchor(frame.session, p.sessionStartedAt, p.now, f)
  if (surface.state === undefined || session !== frame.session) {
    frame = { ...frame, session }
    surface.setState(frame)
  }

  return (
    <Box flexDirection="column" paddingTop={1}>
      <Text color={T.dark}>{'─'.repeat(surface.columns)}</Text>
      {pack(sections(p, f, shown(session, f)), surface.columns).map(line => (
        <Text>
          {line.map(([text, colour]) => (
            <Text color={colour}>{text}</Text>
          ))}
        </Text>
      ))}
    </Box>
  )
}

export default Statusline
