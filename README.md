# Visor

A heads up display for Claude Code. Visor adds a status bar under the prompt showing:

- the current git branch
- the active model
- context window usage
- session time and uncommitted lines added/removed
- the latest GitHub Actions run for your branch, including the job and step that's running or failed

## Requirements

- [Claude Code](https://claude.com/claude-code)
- A [Nerd Font](https://www.nerdfonts.com/) in your terminal. Without one, the icons show as empty boxes.
- The [GitHub CLI](https://cli.github.com/), signed in with `gh auth login`. Only needed for the GitHub Actions section.

## Install

In Claude Code:

```
/plugin marketplace add json-born/visor
/plugin install visor@visor
```

## Configuration

Set these in the plugin's options via `/plugin`:

| Option | Description |
| --- | --- |
| Theme | `Tokyo Night` (default) or `Catppuccin Mocha` |
| Main branch | Your main branch name, e.g. `main` |
| Main workflow | The workflow that runs on pushes to your main branch |
| Branch workflow | The workflow that runs on pull request branches |

Workflow names are passed to `gh run list --workflow`, so use the workflow's name or its file name (e.g. `ci.yml`). If neither workflow is set, the GitHub Actions section is hidden.

Visor polls GitHub every minute, and every 5 seconds while a run is in progress or for two minutes after a `git push`, `gh pr create`, `gh workflow run` or `gh run rerun`.

## Development

```sh
npm install
npm run check      # lint and format with Biome
npm run typecheck
npm test
```

To try your local copy, run `claude --plugin-dir .` from the repo root.

## Licence

[MIT](LICENSE)
