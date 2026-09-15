---
name: pr-stacks
description: Show the stack of pull requests the current thread's branch belongs to with `bb pr-stacks`. Use when the user asks which PRs are stacked, what a PR is based on, or what depends on the current branch.
---

# PR stacks

`bb pr-stacks` prints the chain of open pull requests the thread's branch is
part of. Each nested line is based on the line above it. The current branch's
PR is marked with `*`.

## Commands

| Command | Effect |
| --- | --- |
| `bb pr-stacks` | Print the stack for the current thread. |
| `bb pr-stacks <thread-id>` | Print the stack for another thread. |
| `bb pr-stacks --json` | Machine-readable output: `status`, `repo`, `currentBranch`, and a nested `stack`. |

## Outcomes

- Exit 0 with an indented list: the branch has an open PR and this is its stack.
- Exit 1 with a one-line reason: no open PR for the branch, no GitHub remote,
  `gh` missing, or `gh` not authenticated. Report the reason to the user; do
  not retry in a loop.

## Rules

- The command only reads. It never creates, updates, or merges pull requests.
- Do not run `gh` yourself to rebuild the stack; the command already does it
  on the correct host.
