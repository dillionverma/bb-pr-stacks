import { describe, expect, it } from "vitest";
import {
  buildStacks,
  countStack,
  findStackForBranch,
  flattenStack,
  summarizeChecks,
  type PullRequest,
} from "./stack";

function pr(number: number, head: string, base: string, extra: Partial<PullRequest> = {}): PullRequest {
  return {
    number,
    title: `PR ${number}`,
    headRefName: head,
    baseRefName: base,
    state: "open",
    isDraft: false,
    url: `https://github.com/o/r/pull/${number}`,
    checks: "none",
    ...extra,
  };
}

const numbers = (nodes: ReturnType<typeof buildStacks>) => nodes.map((n) => n.pullRequest.number);

describe("buildStacks", () => {
  it("returns no stacks for no pull requests", () => {
    expect(buildStacks([], "main")).toEqual([]);
  });

  it("treats PRs based on the default branch as roots", () => {
    const stacks = buildStacks([pr(2, "b", "main"), pr(1, "a", "main")], "main");
    expect(numbers(stacks)).toEqual([1, 2]);
    expect(stacks.every((s) => s.children.length === 0)).toBe(true);
  });

  it("nests a chain under its root, in order", () => {
    const stacks = buildStacks(
      [pr(998, "c", "b"), pr(996, "a", "main"), pr(997, "b", "a"), pr(1006, "z", "main")],
      "main",
    );
    expect(numbers(stacks)).toEqual([996, 1006]);
    expect(flattenStack(stacks[0]!)).toMatchObject([
      { pullRequest: { number: 996 }, depth: 0 },
      { pullRequest: { number: 997 }, depth: 1 },
      { pullRequest: { number: 998 }, depth: 2 },
    ]);
    expect(countStack(stacks[0]!)).toBe(3);
  });

  it("supports branching stacks with several children", () => {
    const [root] = buildStacks([pr(1, "a", "main"), pr(2, "b", "a"), pr(3, "c", "a")], "main");
    expect(root!.children.map((c) => c.pullRequest.number)).toEqual([2, 3]);
  });

  it("makes a PR with an orphaned base (no open PR on it) a root", () => {
    const stacks = buildStacks([pr(5, "feature-2", "feature-1"), pr(6, "feature-3", "feature-2")], "main");
    expect(numbers(stacks)).toEqual([5]);
    expect(stacks[0]!.children.map((c) => c.pullRequest.number)).toEqual([6]);
  });

  it("does not loop on cycles and lists every PR exactly once", () => {
    const stacks = buildStacks([pr(1, "a", "b"), pr(2, "b", "a"), pr(3, "c", "main")], "main");
    const all = stacks.flatMap((s) => flattenStack(s).map((e) => e.pullRequest.number));
    expect(all.sort()).toEqual([1, 2, 3]);
    expect(numbers(stacks)).toEqual([3, 1]);
    expect(stacks[1]!.children.map((c) => c.pullRequest.number)).toEqual([2]);
  });

  it("makes a self-based PR a root instead of its own child", () => {
    const stacks = buildStacks([pr(1, "a", "a")], "main");
    expect(numbers(stacks)).toEqual([1]);
    expect(stacks[0]!.children).toEqual([]);
  });

  it("uses the first PR when two share a head branch", () => {
    const stacks = buildStacks([pr(2, "a", "main"), pr(1, "a", "main"), pr(3, "b", "a")], "main");
    expect(numbers(stacks)).toEqual([1, 2]);
    expect(stacks[0]!.children.map((c) => c.pullRequest.number)).toEqual([3]);
    expect(stacks[1]!.children).toEqual([]);
  });
});

describe("findStackForBranch", () => {
  const stacks = buildStacks([pr(1, "a", "main"), pr(2, "b", "a"), pr(3, "c", "main")], "main");

  it("finds the root for a nested branch", () => {
    expect(findStackForBranch(stacks, "b")?.pullRequest.number).toBe(1);
  });

  it("finds the root for a root branch", () => {
    expect(findStackForBranch(stacks, "c")?.pullRequest.number).toBe(3);
  });

  it("returns null for a branch with no PR", () => {
    expect(findStackForBranch(stacks, "main")).toBeNull();
    expect(findStackForBranch(stacks, "nope")).toBeNull();
  });
});

describe("summarizeChecks", () => {
  it("is none without a rollup", () => {
    expect(summarizeChecks(undefined)).toBe("none");
    expect(summarizeChecks(null)).toBe("none");
    expect(summarizeChecks([])).toBe("none");
  });

  it("passes when every check run succeeded, was skipped, or neutral", () => {
    expect(
      summarizeChecks([
        { __typename: "CheckRun", status: "COMPLETED", conclusion: "SUCCESS" },
        { __typename: "CheckRun", status: "COMPLETED", conclusion: "SKIPPED" },
        { __typename: "CheckRun", status: "COMPLETED", conclusion: "NEUTRAL" },
        { __typename: "StatusContext", state: "SUCCESS" },
      ]),
    ).toBe("passing");
  });

  it("fails on any failed run or status, even with pending ones", () => {
    expect(
      summarizeChecks([
        { __typename: "CheckRun", status: "IN_PROGRESS", conclusion: "" },
        { __typename: "CheckRun", status: "COMPLETED", conclusion: "FAILURE" },
      ]),
    ).toBe("failing");
    expect(summarizeChecks([{ __typename: "StatusContext", state: "ERROR" }])).toBe("failing");
  });

  it("is pending while any run is incomplete", () => {
    expect(
      summarizeChecks([
        { __typename: "CheckRun", status: "COMPLETED", conclusion: "SUCCESS" },
        { __typename: "CheckRun", status: "QUEUED", conclusion: "" },
      ]),
    ).toBe("pending");
    expect(summarizeChecks([{ __typename: "StatusContext", state: "PENDING" }])).toBe("pending");
  });
});
