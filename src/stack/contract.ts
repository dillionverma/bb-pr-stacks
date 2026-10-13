// Runtime contracts shared by host.ts, server.ts, and app.tsx.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { StackNode } from "./stack.js";

export const pullRequestSchema = z
  .object({
    number: z.number().int(),
    title: z.string(),
    headRefName: z.string(),
    baseRefName: z.string(),
    state: z.enum(["open", "closed", "merged"]),
    isDraft: z.boolean(),
    url: z.string(),
    checks: z.enum(["passing", "failing", "pending", "none"]),
  })
  .strict();

export const stackNodeSchema: z.ZodType<StackNode> = z.lazy(() =>
  z
    .object({
      pullRequest: pullRequestSchema,
      children: z.array(stackNodeSchema),
    })
    .strict(),
);

/** Why the host could not list pull requests. Each is a normal outcome. */
export const ghProblemSchema = z.enum([
  "gh-missing",
  "gh-unauthenticated",
  "not-github-repo",
  "error",
]);
export type GhProblem = z.infer<typeof ghProblemSchema>;

export const hostContract = defineRpcContract({
  listPullRequests: {
    input: z.object({ cwd: z.string().min(1) }).strict(),
    output: z.discriminatedUnion("status", [
      z
        .object({
          status: z.literal("ok"),
          repo: z.string(),
          defaultBranch: z.string(),
          pullRequests: z.array(pullRequestSchema),
        })
        .strict(),
      z.object({ status: ghProblemSchema, message: z.string() }).strict(),
    ]),
  },
});

export const stackResultSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("ok"),
      repo: z.string(),
      currentBranch: z.string(),
      stack: stackNodeSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal("no-pull-request"),
      repo: z.string(),
      currentBranch: z.string(),
    })
    .strict(),
  z
    .object({
      status: z.enum(["no-environment", "not-git-repo", ...ghProblemSchema.options]),
      message: z.string(),
    })
    .strict(),
]);
export type StackResult = z.infer<typeof stackResultSchema>;

export const rpcContract = defineRpcContract({
  stack_for_thread: {
    input: z.object({ threadId: z.string().min(1) }).strict(),
    output: stackResultSchema,
  },
});
