# visor

A heads up display for Claude Code. Draws one line under the prompt (icons left out here; they need a Nerd Font):

```
main | Fable 5.1 | ████░░░░░░ 41% | 1h12m +84/-12 | ⠦ Deploy › Terraform apply
```

- current branch
- model
- context used
- session time, and the working tree's `+added/-removed` against `HEAD`
- the latest GitHub Actions run on the branch: the running job and step, the failed job and step, passed, queued or cancelled

## Requirements

- a Claude Code build with hooks modules (tested on 2.1.289)
- `gh`, logged in
- a Nerd Font in the terminal, for the icons

## Install

```sh
git clone git@github.com:json-born/visor.git
claude --plugin-dir ./visor
```

To load it in every session, name the folder in `~/.claude/settings.json` instead:

```json
{ "env": { "CLAUDE_CODE_PLUGIN_DIRS": "~/visor" } }
```

## Configure

`/plugin configure visor`, or set any option from the shell:

```sh
echo '{"mainBranch":"main","githubActionsMainWorkflow":"Pipeline","githubActionsBranchWorkflow":"PR Validation"}' \
  | claude plugin configure visor --values-stdin
```

| Option                        | What it is                                                    |
| ----------------------------- | ------------------------------------------------------------- |
| `theme`                       | `Tokyo Night` (default) or `Catppuccin Mocha`                 |
| `mainBranch`                  | the branch that uses the main workflow, e.g. `main`           |
| `githubActionsMainWorkflow`   | name of the workflow that runs on push to `mainBranch`        |
| `githubActionsBranchWorkflow` | name of the workflow that runs on every other branch          |

The Actions section stays hidden until a workflow is set for the current branch.

## Polling

- `gh run list` once a minute, or every 5 seconds while a run is in progress and for two minutes after a `git push`, `gh pr create`, `gh run rerun` or `gh workflow run` goes through the Bash tool
- `git branch` and `git diff --shortstat` every 5 seconds

Everything it runs is read-only.

## Development

```sh
npm install
npm run check      # biome
npm run typecheck  # tsc, once Claude Code has written .claude-plugin/types
npm test           # claude plugin test
```
