# Visor

A heads up display for Claude Code. Visor draws a status line under the prompt (shown here without its Nerd Font icons):

```
main | Fable 5.1 | ████░░░░░░ 41% | 1h12m +84/-12 | ⠦ Deploy › Terraform apply
```

- the current git branch
- the active model
- context window usage
- session time, and the working tree's lines added/removed against `HEAD`
- the latest GitHub Actions run on the branch: the running or failed job and step, or whether it passed, is queued or was cancelled
- a `▸ N` badge when you have CI runs on other branches

Click the CI section, or run `/visor ci`, to expand a table of the latest run on up to six of your other branches, with each run's workflow, state and age. Do the same again to collapse it.

## Requirements

- A Claude Code build with hooks modules (tested on 2.1.289)
- A [Nerd Font](https://www.nerdfonts.com/) in your terminal, for the icons. Without one they show as empty boxes. On macOS: `brew install --cask font-jetbrains-mono-nerd-font`, then select it in your terminal's settings.
- The [GitHub CLI](https://cli.github.com/), signed in with `gh auth login`. Only needed for the GitHub Actions section.

## Install

In Claude Code:

```
/plugin marketplace add json-born/visor
/plugin install visor@visor
```

## Configuration

Run `/plugin configure visor`, or set options from the shell:

```sh
echo '{"mainBranch":"main","githubActionsMainWorkflow":"Pipeline","githubActionsBranchWorkflow":"PR Validation"}' \
  | claude plugin configure visor --values-stdin
```

| Option | Description |
| --- | --- |
| `theme` | `Tokyo Night` (default) or `Catppuccin Mocha` |
| `mainBranch` | The branch that uses the main workflow, e.g. `main` |
| `githubActionsMainWorkflow` | The workflow that runs on pushes to `mainBranch` |
| `githubActionsBranchWorkflow` | The workflow that runs on every other branch |

Workflow names are passed to `gh run list --workflow`, so use the workflow's name or its file name (e.g. `ci.yml`). The GitHub Actions section stays hidden until a workflow is set for the current branch.

## Polling

- `gh run list` once a minute, or every 5 seconds while a run is in progress on any listed branch and for two minutes after a `git push`, `gh pr create`, `gh workflow run` or `gh run rerun` goes through the Bash tool. Other branches come from your 30 most recent runs, filtered to the workflow configured for each branch.
- `git branch` and `git diff --shortstat` every 5 seconds

Everything Visor runs is read-only.

## Development

```sh
npm install
npm run check      # lint and format with Biome
npm run typecheck  # tsc, once Claude Code has written .claude-plugin/types
npm test
```

To try your local copy, run `claude --plugin-dir .` from the repo root.

## Licence

[MIT](LICENSE)
