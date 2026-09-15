# PR Stacks

See the chain behind the change. Pull request stacks, branches, and checks inside BB.

A plugin for [BB](https://getbb.app).

## Highlights

- **Stack at a glance.** An indented PR chain with the current branch highlighted.
- **Review context.** PR titles, draft state, and check status.
- **Header and sidebar.** A stack control in the thread header and integration with Ultra Sidebar hover cards.
- **CLI parity.** Print the same stack with `bb pr-stacks`.

## Install

```sh
bb plugin install https://github.com/dillionverma/bb-pr-stacks
```

Requires BB 0.43+ and a compatible Plugin SDK (see `package.json`).

## Use

Install and authenticate `gh` on each checkout’s host. Open a Git-backed thread with a PR, then select **stack · N**.

`bb pr-stacks [show] [thread-id] [--json]` prints the stack.

## Designed to stay responsive

Host and server caches reuse GitHub CLI results across repeated lookups. Stacks are inferred from PR base/head branch relationships.

## Development

```sh
npm ci
npm run typecheck
npm test
bb plugin build .
```

Focused fixes and reproducible bug reports are welcome. Include BB version, platform, and steps to reproduce.

## Compatibility

The repository and display name are independent of BB’s persistent plugin identity. The internal ID remains `bb-pr-stacks` so existing settings, stored data, CLI commands, and integrations continue to work.

## The Ultra suite

Built for getting work done across multiple threads, agents, and projects. Install only the pieces you need.

- [Ultra Sidebar](https://github.com/dillionverma/bb-plugin-ultra-sidebar) — Organize parallel work.
- [Ultra Launcher](https://github.com/dillionverma/bb-plugin-ultra-launcher) — Start the next run.
- [Ultra Topbar](https://github.com/dillionverma/bb-plugin-ultra-topbar) — Turn threads into pull requests.
- [Linear Panel](https://github.com/dillionverma/bb-plugin-linear-panel) — Keep issues beside execution.
- [Usage Window](https://github.com/dillionverma/bb-plugin-usage-window) — Keep account capacity in view.

## License

MIT. See [LICENSE](LICENSE).
