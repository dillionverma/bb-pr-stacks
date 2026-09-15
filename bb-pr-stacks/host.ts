// Host entry: runs on the enrolled machine that holds the checkout, so it can
// shell out to the GitHub CLI there. Full-trust Node; bundled into dist/host.js.
import { execFile } from "node:child_process";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk";
import type { z } from "zod";
import { hostContract } from "./contract.js";
import { summarizeChecks, type CheckRollupEntry, type PullRequest } from "./stack.js";

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

export function createHostEntry(gh: GhRunner = runGh) {
  return experimental_defineHostEntry({
    contract: hostContract,
    handlers: {
      listPullRequests: async ({ cwd }, { signal }): Promise<ListPullRequestsResult> => {
        const repo = await gh(["repo", "view", "--json", "nameWithOwner,defaultBranchRef"], { cwd, signal });
        if (!repo.ok) {
          if (repo.reason === "not-found") {
            return { status: "gh-missing", message: "GitHub CLI (gh) is not installed on this host." };
          }
          return classifyFailure(repo.stderr);
        }
        const view = JSON.parse(repo.stdout) as {
          nameWithOwner: string;
          defaultBranchRef?: { name?: string } | null;
        };

        const list = await gh(
          ["pr", "list", "--repo", view.nameWithOwner, "--state", "open", "--limit", String(PR_LIMIT), "--json", PR_FIELDS],
          { cwd, signal },
        );
        if (!list.ok) {
          if (list.reason === "not-found") {
            return { status: "gh-missing", message: "GitHub CLI (gh) is not installed on this host." };
          }
          return classifyFailure(list.stderr);
        }
        const raw = JSON.parse(list.stdout) as RawPullRequest[];
        return {
          status: "ok",
          repo: view.nameWithOwner,
          defaultBranch: view.defaultBranchRef?.name ?? "main",
          pullRequests: raw.map(parsePullRequest),
        };
      },
    },
  });
}

export default createHostEntry();
