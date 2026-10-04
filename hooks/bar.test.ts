import { expect, test } from 'claude-code/testing'

import { displayModel, parseShortstat } from './bar'
import { contextColour, reanchor, sessionTime, shown } from './statusline'

test('reads git shortstat', () => {
  expect(parseShortstat(' 3 files changed, 678 insertions(+), 222 deletions(-)')).toEqual({ added: 678, removed: 222 })
  expect(parseShortstat(' 1 file changed, 1 insertion(+)')).toEqual({ added: 1, removed: 0 })
  expect(parseShortstat('')).toEqual({ added: 0, removed: 0 })
})

test('clock keeps counting on its own ticks and only snaps on real drift', () => {
  const a = reanchor(undefined, 0, 10_000, 0)
  expect(shown(a, 25)).toBe(12_000)
  const small = reanchor(a, 0, 13_000, 25)
  expect([small.base, small.f0]).toEqual([a.base, a.f0])
  const big = reanchor(a, 0, 20_000, 25)
  expect(shown(big, 25)).toBe(20_000)
  expect(reanchor(a, 0, 10_000, 99)).toBe(a)
  expect(shown(reanchor(a, 5_000, 20_000, 25), 25)).toBe(15_000)
})

test('turns model ids into display names', () => {
  expect(['claude-opus-5-5', 'claude-sonnet-5-5[1m]', 'claude-haiku-4-5-20251001', 'Opus 5.5', 'custom-model'].map(displayModel)).toEqual([
    'Opus 5.5',
    'Sonnet 5.5',
    'Haiku 4.5',
    'Opus 5.5',
    'custom-model',
  ])
})

test('formats session time and context thresholds', () => {
  expect([sessionTime(59 * 60_000), sessionTime(104 * 60_000)]).toEqual(['59m', '1h44m'])
  expect([contextColour(49), contextColour(50), contextColour(80)]).toEqual(['#9ece6a', '#e0af68', '#f7768e'])
})
