See the pull requests stacked on top of each other for the branch a thread is
working on.

## What you get

- A **stack · N** control in the thread header. Open it for the chain of pull
  requests, indented by depth, with number, title, state, and check status.
- A `bb pr-stacks` command that prints the same chain in a terminal or from an
  agent.

## How it works

The plugin reads open pull requests through the GitHub CLI on the machine that
holds the checkout, then links each pull request to the one whose head branch
is its base branch. Nothing is stored; each open of the thread fetches fresh.

## Requirements

`gh` must be installed and logged in on the host. Without it, the control
explains what is missing instead of failing.
