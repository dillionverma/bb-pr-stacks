import { describe, expect, it } from "vitest";
import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import { createHostEntry, type CommandResult, type GhRunner } from "./host";

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

function fakeGh(results: Record<string, CommandResult>): { gh: GhRunner; calls: { args: string[]; cwd: string }[] } {
  const calls: { args: string[]; cwd: string }[] = [];
  const gh: GhRunner = async (args, { cwd }) => {
    calls.push({ args: [...args], cwd });
    const key = `${args[0]} ${args[1]}`;
    const result = results[key];
    if (result === undefined) throw new Error(`unexpected gh ${key}`);
    return result;
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
    expect(calls[1]!.args).toEqual([
      "pr", "list", "--repo", "acme/widgets", "--state", "open", "--limit", "200",
      "--json", "number,title,headRefName,baseRefName,state,isDraft,url,statusCheckRollup",
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
    const { gh } = fakeGh({ "repo view": { ok: false, reason: "not-found" } });
    expect(await call(gh)).toMatchObject({ status: "gh-missing" });
  });

  it("reports gh-unauthenticated when gh asks to log in", async () => {
    const { gh } = fakeGh({
      "repo view": { ok: false, reason: "failed", exitCode: 4, stderr: "To get started with GitHub CLI, please run:  gh auth login\n" },
    });
    expect(await call(gh)).toMatchObject({ status: "gh-unauthenticated" });
  });

  it("reports not-github-repo when the checkout has no GitHub remote", async () => {
    const { gh } = fakeGh({
      "repo view": { ok: false, reason: "failed", exitCode: 1, stderr: "none of the git remotes configured for this repository point to a known GitHub host\n" },
    });
    expect(await call(gh)).toMatchObject({ status: "not-github-repo" });
  });

  it("reports other failures as error with the first stderr line", async () => {
    const { gh } = fakeGh({
      "repo view": { ok: true, stdout: REPO_VIEW },
      "pr list": { ok: false, reason: "failed", exitCode: 1, stderr: "error connecting to api.github.com\ncheck your internet\n" },
    });
    expect(await call(gh)).toEqual({ status: "error", message: "error connecting to api.github.com" });
  });
});
