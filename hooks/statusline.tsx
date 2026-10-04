import type { ClientModule } from 'claude-code'

import type { Bar, Ci } from '../types'

type Props = Bar & { ci: Ci | null }
type Anchor = { startedAt: number; now: number; base: number; f0: number }
type Frame = { f: number; session?: Anchor }

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
const I = {
  ci: '\uf52e',
  branch: '\ue725',
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

const Statusline: ClientModule<Props, Frame> = (p, surface) => {
  const { Text } = surface.elements
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
  const isPulseOn = Math.floor((f * TICK) / 500) % 2 === 0
  const dim = (text: string) => <Text color={T.comment}>{text}</Text>
  const sep = dim(' | ')

  const ci = p.ci
  const ciBody = (() => {
    if (!ci) return null
    switch (ci.state) {
      case 'running':
        return (
          <Text>
            <Text color={T.fg}>{SPIN[f % SPIN.length]}</Text>
            {ci.detail ? dim(` ${ci.detail}`) : null}
          </Text>
        )
      case 'queued':
        return (
          <Text>
            <Text color={isPulseOn ? T.yellow : T.dark}>{I.queued}</Text>
            <Text color={T.muted}> queued</Text>
            {ci.detail ? dim(`  ${ci.detail}`) : null}
          </Text>
        )
      case 'failed':
        return (
          <Text color={T.red}>
            {I.fail} failed{ci.detail ? <Text>{dim(' › ')}{ci.detail}</Text> : null}
          </Text>
        )
      case 'partial':
        return (
          <Text>
            <Text color={T.green}>{I.check}</Text>
            <Text color={T.muted}> {ci.primary} passed  </Text>
            <Text color={T.red}>{I.fail} {ci.detail} failed</Text>
          </Text>
        )
      case 'passed':
        return (
          <Text>
            <Text color={T.green}>{I.check}</Text>
            <Text color={T.muted}> passed</Text>
          </Text>
        )
      case 'cancelled':
        return dim(`${I.ban} cancelled`)
      case 'checking':
        return dim(`${SPIN[f % SPIN.length]} checking…`)
      default:
        return dim(`${I.none} no runs`)
    }
  })()

  const pct = p.contextPercent
  const filled = pct === null ? 0 : Math.round(pct / 10)

  return (
    <Text>
      {p.branch ? (
        <Text>
          <Text color={T.comment}>{I.branch} </Text>
          <Text color={T.fg}>{p.branch}</Text>
          {sep}
        </Text>
      ) : null}
      <Text color={T.muted}>{p.model}</Text>
      {pct !== null ? (
        <Text>
          {sep}
          <Text color={contextColour(pct)}>{'█'.repeat(filled)}</Text>
          <Text color={T.dark}>{'░'.repeat(10 - filled)}</Text>
          <Text color={contextColour(pct)}> {pct}%</Text>
        </Text>
      ) : null}
      {sep}
      {dim(sessionTime(shown(session, f)))}
      {p.added || p.removed ? (
        <Text>
          {' '}
          <Text color={T.green}>+{p.added}</Text>
          {dim('/')}
          <Text color={T.red}>-{p.removed}</Text>
        </Text>
      ) : null}
      {ciBody ? (
        <Text>
          {sep}
          <Text color={T.comment}>{I.ci}  </Text>
          {ciBody}
        </Text>
      ) : null}
    </Text>
  )
}

export default Statusline
