export const parseShortstat = (out: string) => ({
  added: Number(/(\d+) insertion/.exec(out)?.[1] ?? 0),
  removed: Number(/(\d+) deletion/.exec(out)?.[1] ?? 0),
})

export const displayModel = (id: string) => {
  const m = /^claude-([a-z]+)-(\d+)-(\d+)/.exec(id.replace(/\[.*\]$/, ''))
  return m?.[1] ? `${m[1][0]?.toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}` : id
}
