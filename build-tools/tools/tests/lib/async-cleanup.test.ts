#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  rethrowAfterAsyncCleanup,
  runAsyncCleanupSteps,
  withAsyncCleanup,
} from "./test-helpers/async-cleanup";

test("withAsyncCleanup removes resources after setup failure without masking the primary error", async () => {
  const primary = new Error("forced setup failure");
  const cleanup = new Error("cleanup detail");
  let cleanupCalls = 0;

  await assert.rejects(
    withAsyncCleanup(
      async () => {
        throw primary;
      },
      async () => {
        cleanupCalls += 1;
        throw cleanup;
      },
    ),
    (error) => error === primary,
  );
  assert.equal(cleanupCalls, 1);
  assert.equal(primary.cause, cleanup);
});

test("rethrowAfterAsyncCleanup retains construction and cleanup failures", async () => {
  const primary = new Error("snapshot construction failed");
  const cleanup = new Error("snapshot cleanup failed");
  await assert.rejects(
    rethrowAfterAsyncCleanup(primary, async () => {
      throw cleanup;
    }),
    (error) => error === primary,
  );
  assert.equal(primary.cause, cleanup);
});

test("withAsyncCleanup removes resources once after success", async () => {
  let cleanupCalls = 0;
  const result = await withAsyncCleanup(
    async () => "ok",
    async () => {
      cleanupCalls += 1;
    },
  );
  assert.equal(result, "ok");
  assert.equal(cleanupCalls, 1);
});

test("withAsyncCleanup propagates a cleanup failure once after success", async () => {
  const cleanup = new Error("cleanup failed");
  let cleanupCalls = 0;
  await assert.rejects(
    withAsyncCleanup(
      async () => "ok",
      async () => {
        cleanupCalls += 1;
        throw cleanup;
      },
    ),
    (error) => error === cleanup,
  );
  assert.equal(cleanupCalls, 1);
});

test("runAsyncCleanupSteps attempts every cleanup and aggregates failures", async () => {
  const calls: string[] = [];
  const first = new Error("first cleanup failed");
  const second = new Error("second cleanup failed");
  await assert.rejects(
    runAsyncCleanupSteps([
      async () => {
        calls.push("first");
        throw first;
      },
      async () => {
        calls.push("middle");
      },
      async () => {
        calls.push("last");
        throw second;
      },
    ]),
    (error) =>
      error instanceof AggregateError &&
      error.errors.length === 2 &&
      error.errors[0] === first &&
      error.errors[1] === second,
  );
  assert.deepEqual(calls, ["first", "middle", "last"]);
});

test("withAsyncCleanup retains existing and non-Error primary failure detail", async () => {
  const primary = new Error("primary", { cause: "existing cause" });
  const cleanup = new Error("cleanup");
  await assert.rejects(
    withAsyncCleanup(
      async () => {
        throw primary;
      },
      async () => {
        throw cleanup;
      },
    ),
    (error) =>
      error === primary &&
      primary.cause instanceof AggregateError &&
      primary.cause.errors[0] === "existing cause" &&
      primary.cause.errors[1] === cleanup,
  );

  await assert.rejects(
    withAsyncCleanup(
      async () => {
        throw "primary string";
      },
      async () => {
        throw cleanup;
      },
    ),
    (error) =>
      error instanceof AggregateError &&
      error.cause === "primary string" &&
      error.errors[0] === "primary string" &&
      error.errors[1] === cleanup,
  );
});
