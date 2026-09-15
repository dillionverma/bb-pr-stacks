// bb-plugin-bb-pr-stacks — server entry. Resolves a thread to its checkout,
// asks the host entry for the repo's open pull requests, and infers the stack.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { hostContract, rpcContract, type StackResult } from "./contract.js";
import {
  buildStacks,
  findStackForBranch,
  flattenStack,
  formatChecks,
  formatState,
  type StackNode,
} from "./stack.js";

export { rpcContract, type StackResult };

export default async function plugin(bb: BbPluginApi) {
  const host = bb.hosts.experimental_client({ contract: hostContract });

  async function stackForThread(threadId: string, signal?: AbortSignal): Promise<StackResult> {
    const thread = await bb.sdk.threads.get({ threadId, signal });
    if (thread.environmentId === null) {
      return { status: "no-environment", message: "This thread has no environment yet." };
    }
    const environment = await bb.sdk.environments.get({ environmentId: thread.environmentId, signal });
    if (!environment.isGitRepo || environment.path === null) {
      return { status: "not-git-repo", message: "The thread's environment is not a git checkout." };
    }
    if (environment.branchName === null) {
      return { status: "not-git-repo", message: "The thread's environment has no current branch." };
    }

    const listed = await host.call(
      "listPullRequests",
      { cwd: environment.path },
      { hostId: environment.hostId, signal },
    );
    if (listed.status !== "ok") return listed;

    const defaultBranch = environment.defaultBranch ?? listed.defaultBranch;
    const stacks = buildStacks(listed.pullRequests, defaultBranch);
    const stack = findStackForBranch(stacks, environment.branchName);
    if (stack === null) {
      return { status: "no-pull-request", repo: listed.repo, currentBranch: environment.branchName };
    }
    return { status: "ok", repo: listed.repo, currentBranch: environment.branchName, stack };
  }

  bb.rpc.register(rpcContract, {
    stack_for_thread: ({ threadId }) => stackForThread(threadId),
  });

  const usage = [
    "Usage: bb pr-stacks [show] [<thread-id>] [--json]",
    "Prints the pull request stack for a thread (defaults to the current thread).",
  ].join("\n");
  bb.cli.register({
    name: "pr-stacks",
    summary: "Show the stacked pull requests for a thread",
    commands: [{ name: "show", summary: "Print the stack for a thread", usage: "bb pr-stacks show [<thread-id>] [--json]" }],
    async run(argv, ctx) {
      const json = argv.includes("--json");
      const args = argv.filter((arg) => arg !== "--json" && arg !== "show");
      if (args.includes("--help") || args.includes("help")) return { exitCode: 0, stdout: usage };
      if (args.length > 1) return { exitCode: 1, stderr: usage };
      const threadId = args[0] ?? ctx.threadId;
      if (threadId === undefined) {
        return { exitCode: 1, stderr: "No thread id given and none in the current context.\n" + usage };
      }
      const result = await stackForThread(threadId, ctx.signal);
      if (json) return { exitCode: 0, stdout: JSON.stringify(result) };
      return { exitCode: result.status === "ok" ? 0 : 1, stdout: formatResult(result) };
    },
  });
}

export function formatResult(result: StackResult): string {
  switch (result.status) {
    case "ok":
      return [`${result.repo} · stack of ${flattenStack(result.stack).length} (on ${result.currentBranch})`, formatStack(result.stack, result.currentBranch)].join("\n");
    case "no-pull-request":
      return `${result.repo}: no open pull request for branch ${result.currentBranch}.`;
    default:
      return result.message;
  }
}

export function formatStack(stack: StackNode, currentBranch?: string): string {
  return flattenStack(stack)
    .map(({ pullRequest, depth }) => {
      const marker = pullRequest.headRefName === currentBranch ? "*" : " ";
      return `${marker}${"  ".repeat(depth)}#${pullRequest.number} ${pullRequest.title} (${formatState(pullRequest)}, ${formatChecks(pullRequest.checks)})`;
    })
    .join("\n");
}
