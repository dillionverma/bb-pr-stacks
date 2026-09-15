// Pure stack inference. No BB or Node imports, so it runs in the host entry,
// the server, the frontend bundle, and plain unit tests alike.

export type CheckState = "passing" | "failing" | "pending" | "none";

export interface PullRequest {
  number: number;
  title: string;
  headRefName: string;
  baseRefName: string;
  state: "open" | "closed" | "merged";
  isDraft: boolean;
  url: string;
  checks: CheckState;
}

export interface StackNode {
  pullRequest: PullRequest;
  children: StackNode[];
}

/**
 * Group pull requests into stacks. A PR is a child of the PR whose head branch
 * is its base branch. Roots are PRs based on the default branch, or on a
 * branch that has no open PR (an orphaned base, e.g. one merged already).
 * Cycles cannot reach a root, so their members are appended as extra roots and
 * each PR appears exactly once.
 */
export function buildStacks(
  pullRequests: readonly PullRequest[],
  defaultBranch: string,
): StackNode[] {
  const sorted = [...pullRequests].sort((a, b) => a.number - b.number);
  const byHead = new Map<string, PullRequest>();
  for (const pr of sorted) {
    if (!byHead.has(pr.headRefName)) byHead.set(pr.headRefName, pr);
  }

  const roots: PullRequest[] = [];
  const childrenOf = new Map<string, PullRequest[]>();
  for (const pr of sorted) {
    const parent = byHead.get(pr.baseRefName);
    if (pr.baseRefName === defaultBranch || parent === undefined || parent === pr) {
      roots.push(pr);
      continue;
    }
    const siblings = childrenOf.get(pr.baseRefName) ?? [];
    siblings.push(pr);
    childrenOf.set(pr.baseRefName, siblings);
  }

  const visited = new Set<number>();
  const toNode = (pr: PullRequest): StackNode => {
    visited.add(pr.number);
    const children: StackNode[] = [];
    for (const child of childrenOf.get(pr.headRefName) ?? []) {
      if (!visited.has(child.number)) children.push(toNode(child));
    }
    return { pullRequest: pr, children };
  };

  const stacks = roots.map(toNode);
  for (const pr of sorted) {
    if (!visited.has(pr.number)) stacks.push(toNode(pr));
  }
  return stacks;
}

/** The root of the stack that contains a PR whose head is `branch`, if any. */
export function findStackForBranch(
  stacks: readonly StackNode[],
  branch: string,
): StackNode | null {
  const contains = (node: StackNode): boolean =>
    node.pullRequest.headRefName === branch || node.children.some(contains);
  return stacks.find(contains) ?? null;
}

export interface FlatStackEntry {
  pullRequest: PullRequest;
  depth: number;
}

/** Depth-first, parent before children: the order a nested list renders in. */
export function flattenStack(node: StackNode, depth = 0): FlatStackEntry[] {
  return [
    { pullRequest: node.pullRequest, depth },
    ...node.children.flatMap((child) => flattenStack(child, depth + 1)),
  ];
}

export function countStack(node: StackNode): number {
  return 1 + node.children.reduce((sum, child) => sum + countStack(child), 0);
}

/** One `statusCheckRollup` element as `gh pr list --json` prints it. */
export interface CheckRollupEntry {
  __typename?: string;
  status?: string;
  conclusion?: string;
  state?: string;
}

const FAILED_CONCLUSIONS = new Set([
  "FAILURE",
  "TIMED_OUT",
  "CANCELLED",
  "ACTION_REQUIRED",
  "STARTUP_FAILURE",
  "ERROR",
]);

export function summarizeChecks(
  rollup: readonly CheckRollupEntry[] | null | undefined,
): CheckState {
  if (rollup === null || rollup === undefined || rollup.length === 0) {
    return "none";
  }
  let pending = false;
  for (const entry of rollup) {
    if (entry.__typename === "StatusContext" || entry.state !== undefined) {
      const state = entry.state ?? "";
      if (FAILED_CONCLUSIONS.has(state)) return "failing";
      if (state === "PENDING" || state === "EXPECTED") pending = true;
      continue;
    }
    if (entry.status !== "COMPLETED") {
      pending = true;
      continue;
    }
    if (FAILED_CONCLUSIONS.has(entry.conclusion ?? "")) return "failing";
  }
  return pending ? "pending" : "passing";
}

export function formatState(pr: PullRequest): string {
  return pr.isDraft && pr.state === "open" ? "draft" : pr.state;
}

export function formatChecks(checks: CheckState): string {
  switch (checks) {
    case "passing":
      return "checks passing";
    case "failing":
      return "checks failing";
    case "pending":
      return "checks pending";
    case "none":
      return "no checks";
  }
}
