// bb-plugin-bb-pr-stacks — frontend entry. One control in the thread header:
// "stack · N" that opens a popover listing the stacked pull requests.
import { useEffect, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { definePluginApp, UrlLink, useRpc } from "@get-bb/plugin-sdk/app";
import type { PluginThreadHeaderActionProps } from "@get-bb/plugin-sdk/app";
import type { rpcContract, StackResult } from "./server";
import { countStack, flattenStack, formatChecks, formatState, type CheckState, type StackNode } from "./stack";
import { usePortalScopeProps } from "@/lib/portal-scope";

function useStack(threadId: string): StackResult | null {
  const rpc = useRpc<typeof rpcContract>();
  const [result, setResult] = useState<StackResult | null>(null);
  useEffect(() => {
    let cancelled = false;
    setResult(null);
    rpc.call("stack_for_thread", { threadId }).then(
      (next) => {
        if (!cancelled) setResult(next);
      },
      (cause: unknown) => {
        if (!cancelled) {
          setResult({ status: "error", message: cause instanceof Error ? cause.message : String(cause) });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [rpc, threadId]);
  return result;
}

/** Problems worth a control in the header; other non-ok outcomes render nothing. */
const SHOWN_PROBLEMS = new Set<StackResult["status"]>(["gh-missing", "gh-unauthenticated", "not-github-repo"]);

function shownProblem(result: StackResult): string | null {
  return result.status !== "ok" && "message" in result && SHOWN_PROBLEMS.has(result.status) ? result.message : null;
}

function checkClass(checks: CheckState): string {
  return checks === "failing" ? "text-destructive" : "text-muted-foreground";
}

export function StackList({ stack, currentBranch }: { stack: StackNode; currentBranch: string }) {
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {flattenStack(stack).map(({ pullRequest, depth }) => {
        const isCurrent = pullRequest.headRefName === currentBranch;
        return (
          <li
            key={pullRequest.number}
            style={{ paddingLeft: `${depth * 16}px` }}
            className="flex min-w-0 items-baseline gap-2"
            aria-current={isCurrent ? "true" : undefined}
          >
            <UrlLink href={pullRequest.url} className="shrink-0 font-mono text-xs text-muted-foreground hover:text-foreground">
              #{pullRequest.number}
            </UrlLink>
            <span className={`min-w-0 flex-1 truncate ${isCurrent ? "font-medium text-foreground" : "text-foreground"}`}>
              {pullRequest.title}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">{formatState(pullRequest)}</span>
            <span className={`shrink-0 text-xs ${checkClass(pullRequest.checks)}`}>{formatChecks(pullRequest.checks)}</span>
          </li>
        );
      })}
    </ul>
  );
}

function StackHeaderAction({ threadId, isCompactViewport }: PluginThreadHeaderActionProps) {
  const result = useStack(threadId);
  const portalProps = usePortalScopeProps();
  if (result === null) return null;
  const problem = shownProblem(result);
  if (result.status !== "ok" && problem === null) return null;

  const count = result.status === "ok" ? countStack(result.stack) : 0;
  const label = result.status === "ok" ? `stack · ${count}` : "stack";
  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label={result.status === "ok" ? `Pull request stack of ${count}` : "Pull request stack unavailable"}
        className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-card px-2 text-xs text-muted-foreground hover:text-foreground data-[state=open]:text-foreground"
      >
        {isCompactViewport && result.status === "ok" ? String(count) : label}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          {...portalProps}
          align="end"
          sideOffset={6}
          className="z-50 w-[28rem] max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-card p-3 text-foreground shadow-md"
        >
          {result.status === "ok" ? (
            <>
              <p className="mb-2 text-xs text-muted-foreground">
                {result.repo} · stack · {count}
              </p>
              <StackList stack={result.stack} currentBranch={result.currentBranch} />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{problem}</p>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_threadHeaderAction({
    id: "pr-stack",
    title: "Pull request stack",
    component: StackHeaderAction,
  });
});
