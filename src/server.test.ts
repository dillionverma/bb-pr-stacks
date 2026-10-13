import { describe, expect, it } from "vitest";
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import plugin, { CACHE_FRESH_MS, CACHE_STALE_MS, formatStack } from "./server";
import type { PullRequest } from "./stack/stack";

function pr(number: number, head: string, base: string, extra: Partial<PullRequest> = {}): PullRequest {
  return {
    number,
    title: `PR ${number}`,
    headRefName: head,
    baseRefName: base,
    state: "open",
    isDraft: false,
    url: `https://github.com/acme/widgets/pull/${number}`,
    checks: "passing",
    ...extra,
  };
}

const PRS = [pr(996, "a", "main"), pr(997, "b", "a"), pr(998, "c", "b", { checks: "failing", isDraft: true }), pr(1006, "z", "main")];

async function setup(options: {
  environment?: Partial<{ id: string; hostId: string; path: string | null; isGitRepo: boolean; branchName: string | null; defaultBranch: string | null }>;
  environmentId?: string | null;
  hostResult?: unknown;
  now?: () => number;
} = {}) {
  const environmentId = options.environmentId === undefined ? "env_1" : options.environmentId;
  const environment = {
    id: "env_1",
    hostId: "host_1",
    path: "/work/widgets",
    isGitRepo: true,
    branchName: "b",
    defaultBranch: "main",
    ...options.environment,
  };
  const hostResult = options.hostResult ?? { status: "ok", repo: "acme/widgets", defaultBranch: "main", pullRequests: PRS };
  const { bb, harness } = createFakePluginHost({
    pluginId: "bb-pr-stacks",
    sdk: {
      threads: { get: async ({ threadId }: { threadId: string }) => makeThreadResponse({ id: threadId, environmentId }) },
      environments: { get: async () => environment },
    },
    experimental_callHostRpc: async () => (typeof hostResult === "function" ? hostResult() : hostResult),
  });
  await plugin(bb, { now: options.now });
  return { harness };
}

describe("stack_for_thread rpc", () => {
  it("returns the stack containing the thread's branch and calls the host with the checkout", async () => {
    const { harness } = await setup();
    const result = await harness.behavior.callRpc("stack_for_thread", { threadId: "thr_1" });
    expect(result).toMatchObject({
      status: "ok",
      repo: "acme/widgets",
      currentBranch: "b",
      stack: { pullRequest: { number: 996 }, children: [{ pullRequest: { number: 997 }, children: [{ pullRequest: { number: 998 } }] }] },
    });
    expect(harness.inspection.experimental_hostRpcCalls).toMatchObject([
      { method: "listPullRequests", input: { cwd: "/work/widgets" }, hostId: "host_1" },
    ]);
  });

  it("reports no-pull-request when the branch has no open PR", async () => {
    const { harness } = await setup({ environment: { branchName: "main" } });
    expect(await harness.behavior.callRpc("stack_for_thread", { threadId: "thr_1" })).toEqual({
      status: "no-pull-request",
      repo: "acme/widgets",
      currentBranch: "main",
    });
  });

  it("reports no-environment before touching the host", async () => {
    const { harness } = await setup({ environmentId: null });
    expect(await harness.behavior.callRpc("stack_for_thread", { threadId: "thr_1" })).toMatchObject({ status: "no-environment" });
    expect(harness.inspection.experimental_hostRpcCalls).toEqual([]);
  });

  it("reports not-git-repo for an environment without a checkout", async () => {
    const { harness } = await setup({ environment: { isGitRepo: false } });
    expect(await harness.behavior.callRpc("stack_for_thread", { threadId: "thr_1" })).toMatchObject({ status: "not-git-repo" });
  });

  it("passes host problems through unchanged", async () => {
    const { harness } = await setup({ hostResult: { status: "gh-unauthenticated", message: "Run gh auth login." } });
    expect(await harness.behavior.callRpc("stack_for_thread", { threadId: "thr_1" })).toEqual({
      status: "gh-unauthenticated",
      message: "Run gh auth login.",
    });
  });

  it("falls back to the host's default branch when the environment has none", async () => {
    const { harness } = await setup({
      environment: { defaultBranch: null, branchName: "z" },
      hostResult: { status: "ok", repo: "acme/widgets", defaultBranch: "main", pullRequests: PRS },
    });
    expect(await harness.behavior.callRpc("stack_for_thread", { threadId: "thr_1" })).toMatchObject({
      status: "ok",
      stack: { pullRequest: { number: 1006 }, children: [] },
    });
  });
});

describe("stack_for_thread cache", () => {
  function fixture(hostResults: unknown[]) {
    let now = 1_000_000;
    let hostCalls = 0;
    const promise = setup({
      now: () => now,
      hostResult: () => hostResults[Math.min(hostCalls++, hostResults.length - 1)],
    });
    return {
      promise,
      tick: (ms: number) => (now += ms),
      hostCalls: () => hostCalls,
    };
  }
  const ok = { status: "ok", repo: "acme/widgets", defaultBranch: "main", pullRequests: PRS };
  const okEmpty = { status: "ok", repo: "acme/widgets", defaultBranch: "main", pullRequests: [] };

  it("answers a repeat call for the same thread without asking the host again", async () => {
    const f = fixture([ok, okEmpty]);
    const { harness } = await f.promise;
    await harness.behavior.callRpc("stack_for_thread", { threadId: "thr_1" });
    f.tick(CACHE_FRESH_MS - 1);
    expect(await harness.behavior.callRpc("stack_for_thread", { threadId: "thr_1" })).toMatchObject({ status: "ok" });
    expect(f.hostCalls()).toBe(1);
  });

  it("serves a stale answer at once and refreshes it behind the caller", async () => {
    const f = fixture([ok, okEmpty]);
    const { harness } = await f.promise;
    await harness.behavior.callRpc("stack_for_thread", { threadId: "thr_1" });
    f.tick(CACHE_FRESH_MS + 1);
    expect(await harness.behavior.callRpc("stack_for_thread", { threadId: "thr_1" })).toMatchObject({ status: "ok" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(f.hostCalls()).toBe(2);
    expect(await harness.behavior.callRpc("stack_for_thread", { threadId: "thr_1" })).toMatchObject({ status: "no-pull-request" });
    expect(f.hostCalls()).toBe(2);
  });

  it("waits for a fresh answer once the old one has expired", async () => {
    const f = fixture([ok, okEmpty]);
    const { harness } = await f.promise;
    await harness.behavior.callRpc("stack_for_thread", { threadId: "thr_1" });
    f.tick(CACHE_FRESH_MS + CACHE_STALE_MS + 1);
    expect(await harness.behavior.callRpc("stack_for_thread", { threadId: "thr_1" })).toMatchObject({ status: "no-pull-request" });
  });

  it("does not remember a problem outcome", async () => {
    const f = fixture([{ status: "gh-unauthenticated", message: "Run gh auth login." }, ok]);
    const { harness } = await f.promise;
    expect(await harness.behavior.callRpc("stack_for_thread", { threadId: "thr_1" })).toMatchObject({ status: "gh-unauthenticated" });
    expect(await harness.behavior.callRpc("stack_for_thread", { threadId: "thr_1" })).toMatchObject({ status: "ok" });
    expect(f.hostCalls()).toBe(2);
  });

  it("keeps the cli on live data", async () => {
    const f = fixture([ok, okEmpty]);
    const { harness } = await f.promise;
    await harness.behavior.callRpc("stack_for_thread", { threadId: "thr_1" });
    const result = await harness.behavior.runCli(["thr_1", "--json"]);
    expect(JSON.parse(result.stdout ?? "")).toMatchObject({ status: "no-pull-request" });
    expect(f.hostCalls()).toBe(2);
  });
});

describe("bb pr-stacks cli", () => {
  it("prints the indented stack for the context thread", async () => {
    const { harness } = await setup();
    const result = await harness.behavior.runCli([], { threadId: "thr_1" });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      [
        "acme/widgets · stack of 3 (on b)",
        "  #996 PR 996 (open, checks passing)",
        "*   #997 PR 997 (open, checks passing)",
        "      #998 PR 998 (draft, checks failing)",
      ].join("\n"),
    );
  });

  it("accepts an explicit thread id and --json", async () => {
    const { harness } = await setup();
    const result = await harness.behavior.runCli(["show", "thr_9", "--json"]);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout ?? "")).toMatchObject({ status: "ok", currentBranch: "b" });
  });

  it("fails with usage when no thread is known", async () => {
    const { harness } = await setup();
    const result = await harness.behavior.runCli([]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Usage: bb pr-stacks");
  });

  it("exits non-zero with the message for a problem outcome", async () => {
    const { harness } = await setup({ hostResult: { status: "gh-missing", message: "gh is not installed." } });
    const result = await harness.behavior.runCli(["thr_1"]);
    expect(result).toMatchObject({ exitCode: 1, stdout: "gh is not installed." });
  });
});

describe("formatStack", () => {
  it("marks the current branch and indents by depth", () => {
    const stack = { pullRequest: pr(1, "a", "main"), children: [{ pullRequest: pr(2, "b", "a"), children: [] }] };
    expect(formatStack(stack, "b")).toBe("  #1 PR 1 (open, checks passing)\n*   #2 PR 2 (open, checks passing)");
  });
});
