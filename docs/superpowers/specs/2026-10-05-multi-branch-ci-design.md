# Multi-branch CI view

## Goal

Let the visor statusline expand to show CI runs across the user's other branches, not just the current one. Ship one view ("my branches") now, structured so other views (team activity, worktrees, …) can be added later as alternative sources.

## Behaviour

- The statusline's CI segment looks and behaves as today for the current branch.
- After it, a badge shows how many other branches have CI runs: `▸ N` collapsed, `▾ N` expanded, nothing when there are none.
- Expanded, rows appear under the statusline: the current branch first (marked `●`), then the other branches, newest first.
- Clicking the CI segment or the badge toggles expanded/collapsed. `/visor ci` does the same. Both flip one shared value.

```text
 ⎇ feat/ci-view | ◆ Opus 5.5 | ███░░░░░░░ 34% | ◷ 12m +40/-3
 ▶ ⠋ build › unit tests  ▾ 3
   ● ⠋ feat/ci-view       CI      build › unit tests      2m
     ✗ fix/token-refresh  CI      lint › biome check     14m
     ⧗ chore/deps         CI      queued                  3m
     ✓ main               Deploy  passed                  1h
```

"My branches" means branches with runs the user triggered (`gh run list --user <login>`).

## Data

```ts
// types/index.d.ts
export type CIRun = {
  branch: string
  workflow?: string
  status?: string        // unset = no runs on this branch
  conclusion?: string
  detail?: string        // "<job> › <step>" for what's running or what failed
  error?: string         // gh stderr when listing failed
  updatedAt?: number     // ms epoch, for the age column
}

export type CIRuns = { current: CIRun; others: CIRun[] }
```

Atoms:

- `visor/ci-runs: CIRuns | null` replaces `visor/github-actions`. `null` means no current branch or no workflow configured, and the CI segment is hidden.
- `visor/ci-expanded: boolean` is shared by the click and the command. The poller never reads it.

`GithubActionsStatus` is removed.

## Polling

One poller (`pollCIRuns`) replaces `pollGithub`. It makes two list requests per poll, in parallel:

```text
pollCIRuns($)
  branch   = git branch --show-current               → null if none
  workflow = configured workflow for branch          → null if unset
  Promise.all
    current = fetchCurrent(branch, workflow)         # gh run list --branch <b> --workflow <w> -L 1
    others  = source.fetch($, { branch, config })
  addDetail to current and to every other row that is running or failing (parallel)
  return { current, others }
```

`others` always carries detail, whether or not the view is expanded.

The gh calls live in `register.tsx` because a hooks module can't pass `$` into a function imported from another file. `ci-runs.ts` holds only the pure helpers that read what gh returns. A future view is another `fetch…` function beside `fetchOthers`, returning `CIRun[] | null`.

`fetchOthers` (the "my branches" view):

1. `login` is fetched with `gh api user -q .login` and cached in the module after the first success.
2. `gh run list --user <login> -L 30 --json headBranch,workflowName,status,conclusion,databaseId,updatedAt`
3. Drop the current branch.
4. Keep runs whose `workflowName` is the configured workflow for that branch: `githubActionsMainWorkflow` on `mainBranch`, `githubActionsBranchWorkflow` everywhere else.
5. Keep the newest run per branch, sort by `updatedAt` descending, and cap at 6.

Cadence is unchanged except for the trigger: poll every 5s if the current run or any other run isn't completed, or within 2 minutes of a push/rerun/PR create; otherwise every 60s. Push/rerun/PR-create commands still wake the loop immediately.

## Rendering

`ui.render(PromptHint)` passes `{ ...session, ci, expanded, now, theme }` to the client.

`component.tsx`:

- `buildActionsSpans(actions)` becomes `buildRunSpans(run: CIRun)`. The body and states stay the same (checking, no runs, queued, running, failed, cancelled, passed).
- `badge(n, expanded)` returns `  ▸ n` / `  ▾ n`, or nothing when `n = 0`.
- `buildRows(ci, now, frame, colour)` builds one row per run with marker, icon, branch, workflow, detail or state, and age. Branch and workflow are padded to the widest value, and each row is truncated with `…` to `surface.columns`. Icons and colours match the collapsed segment.
- `formatAge(ms)` returns `2m` / `1h` / `3d`.
- `wrapSections` also records the line and column range of the CI segment and badge, for click hit-testing.
- `surface.onPointer`: on `down` inside the CI segment or badge, `surface.post({ toggle: 'ci' })`. Clicks elsewhere do nothing.

`register.tsx`:

- A `ui.message` hook handles `{ toggle: 'ci' }` by flipping `ci-expanded`.
- The `/visor ci` command flips `ci-expanded`.

## Files

```text
hooks/
├── register.tsx      # loop, gh calls (fetchCurrent, fetchOthers, addDetail), render hook, toggle message, /visor ci
├── ci-runs.ts        # pure helpers: workflowFor, latestPerBranch, pickOthers, describeProgress
├── component.tsx     # badge, rows, click → post
types/index.d.ts      # CIRun, CIRuns, atoms
```

## Errors

| Failure | Result |
|---|---|
| current-branch list fails | `current = { branch, error }` (as today) |
| login lookup fails | previous `others` kept, lookup retried next poll |
| others list fails | previous `others` kept |
| job detail fails for a row | row shown without detail |
| unreadable gh output / throw | toast, previous `CIRuns` kept |
| loop crash | "GitHub polling stopped" toast (unchanged) |

A failure in one half never blanks the other.

## Tests

`hooks/register.test.tsx`. The existing tests stay, updated for the renamed atom and props:

- shows the latest run of the branch workflow
- watches the main workflow on the main branch
- names the running job and step
- names the failed job and step
- shows no runs when gh cannot list them
- shows a toast when gh output is unreadable
- skips GitHub outside a branch
- skips GitHub until a workflow is configured
- polls every 5 seconds while any run is in progress, including on other branches
- polls once a minute when nothing is running

New:

- lists other branches owned by user, capped at 6, descending order
- filters by the configured workflow for each branch
- leaves the current branch out of the other branches
- names the running and failed job and step on other branches
- keeps showing other branches when listing them fails
- toggles the expanded view from a click and from /visor ci

`hooks/ci-runs.test.ts` (new):

- keeps only the newest run for each branch
- formats ages as minutes, hours and days

`hooks/component.test.ts`. The existing tests stay. New:

- shows ▸ N collapsed, ▾ N expanded, nothing when there are no additional CI runs
- lists the current branch first, then other branches with aligned columns, truncated to fit
- toggles when the CI segment is clicked and ignores clicks elsewhere

Tests run with `claude plugin test`. `npm run check` and `npm run typecheck` stay clean.

## Out of scope

- Views other than "my branches" (the source interface is the extension point).
- Choosing the view through config. Add it alongside the second source.
- Opening a run in the browser from a row.
