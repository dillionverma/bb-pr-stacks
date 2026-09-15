# bb-pr-stacks

A [BB](https://github.com/get-bb/bb) plugin that shows the **stack of pull
requests** a thread's branch belongs to: the chain where each PR's base branch
is another PR's head branch.

```
 #1007 fix(env): make development secrets refresh explicit and safe (open, checks passing)
   #1008 fix(setup): unify offline worktree preparation (draft, checks passing)
*    #1009 fix(workflow): make checks read-only and complete (draft, checks failing)
       #1010 ci: split verification and preserve checks result (draft, checks failing)
```

## What you get

- A `stack · N` control in the thread header. Opening it lists the stack as an
  indented chain with PR number, title, state, and check status. The thread's
  own PR is highlighted.
- A `bb pr-stacks [show] [<thread-id>] [--json]` command that prints the same
  stack from a shell. Inside a thread the id defaults to the current thread.
- A skill that tells agents how to use the command.

## How it works

BB's SDK exposes one pull request per environment and no repo-wide listing, so
the data comes from the [GitHub CLI](https://cli.github.com). The plugin's
`bb.host` entry runs on the machine that holds the checkout and shells out to:

```
gh repo view --json nameWithOwner,defaultBranchRef
gh pr list --repo <owner/repo> --state open --json number,title,headRefName,baseRefName,state,isDraft,url,statusCheckRollup
```

The server resolves a thread to its environment (checkout path, host, branch,
default branch), asks the host for the open PRs, and infers stacks in
`stack.ts`:

- A PR is a child of the PR whose head branch equals its base branch.
- Roots are PRs based on the default branch, or on a branch with no open PR
  (an orphaned base, for example one that was merged already).
- Cycles cannot reach a root, so their members become extra roots. Every PR
  appears exactly once.

Outcomes that are not stacks are reported, never thrown: `gh` not installed,
`gh` not authenticated, a checkout without a GitHub remote, a thread without an
environment or git checkout, and a branch with no open PR. The header control
appears only when there is a stack or a `gh` problem worth showing.

## Requirements

- BB 0.43 or newer.
- `gh` installed and authenticated (`gh auth login`) on the host that runs the
  thread's environment.

## Install

```
bb plugin install git:https://github.com/dillionverma/bb-pr-stacks
```

Or from a checkout:

```
npm install
bb plugin install .
```

## Develop

```
npm install
npm test            # vitest: stack inference, host entry, server rpc/cli, header action
npm run typecheck
bb plugin build
bb plugin dev       # rebuild + reload on save
```

Files:

- `stack.ts` — pure stack inference and check summarization.
- `contract.ts` — zod contracts shared by host, server, and app.
- `host.ts` — runs `gh` on the host; the runner is injectable for tests.
- `server.ts` — `stack_for_thread` RPC and the `bb pr-stacks` command.
- `app.tsx` — the thread header control.
