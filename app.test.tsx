// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { StackResult } from "./contract";
import type { PullRequest } from "./stack";

function pr(number: number, head: string, base: string, extra: Partial<PullRequest> = {}): PullRequest {
  return {
    number,
    title: `Title ${number}`,
    headRefName: head,
    baseRefName: base,
    state: "open",
    isDraft: false,
    url: `https://github.com/acme/widgets/pull/${number}`,
    checks: "passing",
    ...extra,
  };
}

const OK: StackResult = {
  status: "ok",
  repo: "acme/widgets",
  currentBranch: "b",
  stack: {
    pullRequest: pr(996, "a", "main"),
    children: [{ pullRequest: pr(997, "b", "a"), children: [{ pullRequest: pr(998, "c", "b", { checks: "failing", isDraft: true }), children: [] }] }],
  },
};

beforeAll(() => {
  // Radix popper measures with ResizeObserver, which jsdom lacks.
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;
});

async function render(result: StackResult, isCompactViewport = false) {
  const app = await loadPluginApp(() => import("./app"));
  const action = app.threadHeaderActions[0]!;
  expect(action.id).toBe("pr-stack");
  return renderSlot(
    action,
    { threadId: "thr_1", projectId: "proj_1", isCompactViewport },
    { rpc: { stack_for_thread: () => result } },
  );
}

describe("thread header action", () => {
  it("shows the stack size and lists the chain when opened", async () => {
    const slot = await render(OK);
    const trigger = await slot.findByRole("button", { name: "Pull request stack of 3" });
    expect(trigger.textContent).toBe("stack · 3");
    expect(slot.inspection.rpcCalls).toMatchObject([{ method: "stack_for_thread", input: { threadId: "thr_1" } }]);

    fireEvent.click(trigger);
    const items = await slot.findAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "#996Title 996openchecks passing",
      "#997Title 997openchecks passing",
      "#998Title 998draftchecks failing",
    ]);
    expect(items.map((item) => item.style.paddingLeft)).toEqual(["0px", "16px", "32px"]);
    expect(items[1]!.getAttribute("aria-current")).toBe("true");
    expect(items[2]!.querySelector(".text-destructive")?.textContent).toBe("checks failing");
    slot.lifecycle.unmount();
  });

  it("collapses to the count on compact viewports", async () => {
    const slot = await render(OK, true);
    const trigger = await slot.findByRole("button", { name: "Pull request stack of 3" });
    expect(trigger.textContent).toBe("3");
    slot.lifecycle.unmount();
  });

  it("renders nothing when the branch has no pull request", async () => {
    const slot = await render({ status: "no-pull-request", repo: "acme/widgets", currentBranch: "main" });
    await waitFor(() => expect(slot.inspection.rpcCalls).toHaveLength(1));
    expect(slot.queryByRole("button")).toBeNull();
    slot.lifecycle.unmount();
  });

  it("surfaces a gh problem behind a muted control", async () => {
    const slot = await render({ status: "gh-unauthenticated", message: "GitHub CLI is not authenticated." });
    const trigger = await slot.findByRole("button", { name: "Pull request stack unavailable" });
    fireEvent.click(trigger);
    await slot.findByText("GitHub CLI is not authenticated.");
    slot.lifecycle.unmount();
  });
});
