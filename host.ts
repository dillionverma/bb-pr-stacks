// Host entry: runs on the enrolled machine that holds the checkout, so it can
// shell out to the GitHub CLI there. Full-trust Node; bundled into dist/host.js.
import { execFile } from "node:child_process";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk";
import type { z } from "zod";
import { hostContract } from "./contract.js";
import { summarizeChecks, type CheckRollupEntry, type PullRequest } from "./stack.js";
import { createSwrCache } from "./swr-cache.js";

export type CommandResult =
  | { ok: true; stdout: string }
  | { ok: false; reason: "not-found" }
  | { ok: false; reason: "failed"; exitCode: number | null; stderr: string };

/** Runs `gh <args>` in `cwd`. Injected so tests never touch a real gh. */
export type GhRunner = (
  args: readonly string[],
  options: { cwd: string; signal: AbortSignal },
) => Promise<CommandResult>;

export const runGh: GhRunner = (args, { cwd, signal }) =>
  new Promise((resolve) => {
    execFile(
      "gh",
      args,
      { cwd, signal, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, GH_PROMPT_DISABLED: "1", NO_COLOR: "1" } },
      (error, stdout, stderr) => {
        if (error === null) return resolve({ ok: true, stdout });
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT") return resolve({ ok: false, reason: "not-found" });
        resolve({
          ok: false,
          reason: "failed",
          exitCode: typeof code === "number" ? code : null,
          stderr: stderr || error.message,
        });
      },
    );
  });

const PR_FIELDS = "number,title,headRefName,baseRefName,state,isDraft,url,statusCheckRollup";
const PR_LIMIT = 200;

/**
 * `gh pr list` with check rollups takes a second or more against GitHub, and
 * a hover card asks about the same checkout again and again. Within this
 * window the last answer comes back at once; a slightly older one is served
 * too, while a refresh runs behind the card rather than in front of it.
 */
export const CACHE_FRESH_MS = 30_000;
export const CACHE_STALE_MS = 5 * 60_000;

/** A `gh` call that hangs this long is not going to answer. */
const GH_TIMEOUT_MS = 30_000;

interface RawPullRequest {
  number: number;
  title: string;
  headRefName: string;
  baseRefName: string;
  state: string;
  isDraft: boolean;
  url: string;
  statusCheckRollup?: CheckRollupEntry[] | null;
}

export function parsePullRequest(raw: RawPullRequest): PullRequest {
  const state = raw.state.toLowerCase();
  return {
    number: raw.number,
    title: raw.title,
    headRefName: raw.headRefName,
    baseRefName: raw.baseRefName,
    state: state === "merged" || state === "closed" ? state : "open",
    isDraft: raw.isDraft,
    url: raw.url,
    checks: summarizeChecks(raw.statusCheckRollup),
  };
}

type ListPullRequestsResult = z.output<typeof hostContract.listPullRequests.output>;

function classifyFailure(stderr: string): ListPullRequestsResult {
  const message = stderr.trim().split("\n")[0] ?? "gh failed";
  if (/gh auth login|not logged in|authentication token|GH_TOKEN/i.test(stderr)) {
    return { status: "gh-unauthenticated", message: "GitHub CLI is not authenticated. Run `gh auth login`." };
  }
  if (/no git remotes|not a git repository|none of the git remotes|could not find any git remotes|unable to determine base repository/i.test(stderr)) {
    return { status: "not-github-repo", message: "This checkout has no GitHub remote." };
  }
  return { status: "error", message };
}

const GH_MISSING: ListPullRequestsResult = {
  status: "gh-missing",
  message: "GitHub CLI (gh) is not installed on this host.",
};

/** Both `gh` calls resolve the repo from the checkout, so they run side by side. */
export async function listPullRequests(
  gh: GhRunner,
  cwd: string,
  signal: AbortSignal,
): Promise<ListPullRequestsResult> {
  const [repo, list] = await Promise.all([
    gh(["repo", "view", "--json", "nameWithOwner,defaultBranchRef"], { cwd, signal }),
    gh(["pr", "list", "--state", "open", "--limit", String(PR_LIMIT), "--json", PR_FIELDS], { cwd, signal }),
  ]);
  // When gh or the checkout is the problem both calls fail; the repo view's
  // message is the clearer one, so its verdict wins.
  if (!repo.ok) return repo.reason === "not-found" ? GH_MISSING : classifyFailure(repo.stderr);
  if (!list.ok) return list.reason === "not-found" ? GH_MISSING : classifyFailure(list.stderr);

  const view = JSON.parse(repo.stdout) as {
    nameWithOwner: string;
    defaultBranchRef?: { name?: string } | null;
  };
  const raw = JSON.parse(list.stdout) as RawPullRequest[];
  return {
    status: "ok",
    repo: view.nameWithOwner,
    defaultBranch: view.defaultBranchRef?.name ?? "main",
    pullRequests: raw.map(parsePullRequest),
  };
}

export function createHostEntry(gh: GhRunner = runGh, options: { now?: () => number } = {}) {
  const cache = createSwrCache<string, ListPullRequestsResult>({
    freshMs: CACHE_FRESH_MS,
    staleMs: CACHE_STALE_MS,
    now: options.now,
  });
  return experimental_defineHostEntry({
    contract: hostContract,
    handlers: {
      listPullRequests: async ({ cwd }): Promise<ListPullRequestsResult> => {
        // A load may outlive the request that started it (a stale refresh),
        // so it gets its own deadline rather than the caller's signal.
        const result = await cache.get(cwd, () =>
          listPullRequests(gh, cwd, AbortSignal.timeout(GH_TIMEOUT_MS)),
        );
        // A problem is worth reporting, not remembering: the call right after
        // `gh auth login` should see the fix.
        if (result.status !== "ok") cache.clear(cwd);
        return result;
      },
    },
  });
}

export default createHostEntry();
