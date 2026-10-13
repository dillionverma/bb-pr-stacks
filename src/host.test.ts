import { describe, expect, it } from "vitest";
import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import { CACHE_FRESH_MS, CACHE_STALE_MS, createHostEntry, type CommandResult, type GhRunner } from "./host";

const REPO_VIEW = JSON.stringify({ nameWithOwner: "acme/widgets", defaultBranchRef: { name: "develop" } });
const PR_LIST = JSON.stringify([
  {
    number: 7,
    title: "Add widgets",
    headRefName: "widgets",
    baseRefName: "develop",
    state: "OPEN",
    isDraft: true,
    url: "https://github.com/acme/widgets/pull/7",
    statusCheckRollup: [{ __typename: "CheckRun", status: "COMPLETED", conclusion: "FAILURE" }],
  },
]);

const NOT_FOUND: CommandResult = { ok: false, reason: "not-found" };

function fakeGh(results: Record<string, CommandResult | (() => CommandResult)>): {
  gh: GhRunner;
  calls: { args: string[]; cwd: string }[];
} {
  const calls: { args: string[]; cwd: string }[] = [];
  const gh: GhRunner = async (args, { cwd }) => {
    calls.push({ args: [...args], cwd });
    const key = `${args[0]} ${args[1]}`;
    const result = results[key];
    if (result === undefined) throw new Error(`unexpected gh ${key}`);
    return typeof result === "function" ? result() : result;
  };
  return { gh, calls };
}

async function call(gh: GhRunner, cwd = "/repo") {
  const harness = experimental_createHostEntryHarness(createHostEntry(gh));
  try {
    return await harness.experimental_call("listPullRequests", { cwd });
  } finally {
    await harness.experimental_dispose();
  }
}

describe("host listPullRequests", () => {
  it("returns parsed pull requests, the repo, and its default branch", async () => {
    const { gh, calls } = fakeGh({
      "repo view": { ok: true, stdout: REPO_VIEW },
      "pr list": { ok: true, stdout: PR_LIST },
    });
    const result = await call(gh, "/work/widgets");
    expect(result).toEqual({
      status: "ok",
      repo: "acme/widgets",
      defaultBranch: "develop",
      pullRequests: [
        {
          number: 7,
          title: "Add widgets",
          headRefName: "widgets",
          baseRefName: "develop",
          state: "open",
          isDraft: true,
          url: "https://github.com/acme/widgets/pull/7",
          checks: "failing",
        },
      ],
    });
    expect(calls.every((c) => c.cwd === "/work/widgets")).toBe(true);
    // Both commands read the repo from the checkout, so neither waits on the other.
    expect(calls.map((c) => c.args)).toEqual([
      ["repo", "view", "--json", "nameWithOwner,defaultBranchRef"],
      [
        "pr", "list", "--state", "open", "--limit", "200",
        "--json", "number,title,headRefName,baseRefName,state,isDraft,url,statusCheckRollup",
      ],
    ]);
  });

  it("returns ok with no pull requests for a repo without any", async () => {
    const { gh } = fakeGh({
      "repo view": { ok: true, stdout: REPO_VIEW },
      "pr list": { ok: true, stdout: "[]" },
    });
    expect(await call(gh)).toMatchObject({ status: "ok", pullRequests: [] });
  });

  it("reports gh-missing when gh is not on PATH", async () => {
    const { gh } = fakeGh({ "repo view": NOT_FOUND, "pr list": NOT_FOUND });
    expect(await call(gh)).toMatchObject({ status: "gh-missing" });
  });

  it("reports gh-unauthenticated when gh asks to log in", async () => {
    const failed: CommandResult = {
      ok: false,
      reason: "failed",
      exitCode: 4,
      stderr: "To get started with GitHub CLI, please run:  gh auth login\n",
    };
    const { gh } = fakeGh({ "repo view": failed, "pr list": failed });
    expect(await call(gh)).toMatchObject({ status: "gh-unauthenticated" });
  });

  it("reports not-github-repo when the checkout has no GitHub remote", async () => {
    const failed: CommandResult = {
      ok: false,
      reason: "failed",
      exitCode: 1,
      stderr: "none of the git remotes configured for this repository point to a known GitHub host\n",
    };
    const { gh } = fakeGh({ "repo view": failed, "pr list": failed });
    expect(await call(gh)).toMatchObject({ status: "not-github-repo" });
  });

  it("reports other failures as error with the first stderr line", async () => {
    const { gh } = fakeGh({
      "repo view": { ok: true, stdout: REPO_VIEW },
      "pr list": { ok: false, reason: "failed", exitCode: 1, stderr: "error connecting to api.github.com\ncheck your internet\n" },
    });
    expect(await call(gh)).toEqual({ status: "error", message: "error connecting to api.github.com" });
  });

  describe("cache", () => {
    function fixture() {
      let now = 1_000_000;
      const { gh, calls } = fakeGh({
        "repo view": { ok: true, stdout: REPO_VIEW },
        "pr list": () => ({ ok: true, stdout: calls.length <= 2 ? PR_LIST : "[]" }),
      });
      const harness = experimental_createHostEntryHarness(createHostEntry(gh, { now: () => now }));
      return {
        harness,
        calls,
        tick: (ms: number) => (now += ms),
        list: (cwd = "/repo") => harness.experimental_call("listPullRequests", { cwd }),
      };
    }

    it("answers a repeat call for the same checkout without running gh again", async () => {
      const f = fixture();
      try {
        await f.list();
        f.tick(CACHE_FRESH_MS - 1);
        expect(await f.list()).toMatchObject({ pullRequests: [{ number: 7 }] });
        expect(f.calls).toHaveLength(2);
      } finally {
        await f.harness.experimental_dispose();
      }
    });

    it("keys the cache by checkout", async () => {
      const f = fixture();
      try {
        await f.list("/one");
        await f.list("/two");
        expect(f.calls.map((c) => c.cwd)).toEqual(["/one", "/one", "/two", "/two"]);
      } finally {
        await f.harness.experimental_dispose();
      }
    });

    it("serves a stale answer at once and refreshes it behind the caller", async () => {
      const f = fixture();
      try {
        await f.list();
        f.tick(CACHE_FRESH_MS + 1);
        expect(await f.list()).toMatchObject({ pullRequests: [{ number: 7 }] });
        expect(f.calls).toHaveLength(4);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(await f.list()).toMatchObject({ pullRequests: [] });
        expect(f.calls).toHaveLength(4);
      } finally {
        await f.harness.experimental_dispose();
      }
    });

    it("waits for a fresh answer once the old one has expired", async () => {
      const f = fixture();
      try {
        await f.list();
        f.tick(CACHE_FRESH_MS + CACHE_STALE_MS + 1);
        expect(await f.list()).toMatchObject({ pullRequests: [] });
      } finally {
        await f.harness.experimental_dispose();
      }
    });

    it("does not remember a problem", async () => {
      let attempts = 0;
      const { gh, calls } = fakeGh({
        "repo view": () => {
          attempts += 1;
          return attempts === 1 ? NOT_FOUND : { ok: true, stdout: REPO_VIEW };
        },
        "pr list": () => (attempts === 1 ? NOT_FOUND : { ok: true, stdout: PR_LIST }),
      });
      const harness = experimental_createHostEntryHarness(createHostEntry(gh));
      try {
        expect(await harness.experimental_call("listPullRequests", { cwd: "/repo" })).toMatchObject({ status: "gh-missing" });
        expect(await harness.experimental_call("listPullRequests", { cwd: "/repo" })).toMatchObject({ status: "ok" });
        expect(calls).toHaveLength(4);
      } finally {
        await harness.experimental_dispose();
      }
    });
  });
});
