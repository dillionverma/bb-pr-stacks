See the chain behind the change. Pull request stacks, branches, and checks inside BB.

## What you get

- **Stack at a glance.** An indented PR chain with the current branch highlighted.
- **Review context.** PR titles, draft state, and check status.
- **Header and sidebar.** A stack control in the thread header and integration with Ultra Sidebar hover cards.
- **CLI parity.** Print the same stack with `bb pr-stacks`.

## Requirements

Install and authenticate `gh` on each checkout’s host. Open a Git-backed thread with a PR, then select **stack · N**.

`bb pr-stacks [show] [thread-id] [--json]` prints the stack.

## Source

[Source and installation](https://github.com/dillionverma/bb-pr-stacks)
