#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  removeOwnedTempTree,
  rethrowAfterOwnedTempCleanup,
  runOwnedTempCleanup,
  withOwnedTempCleanup,
} from "../../lib/owned-temp-cleanup";

test("owned temp cleanup attempts all steps and reports deletion failures", async () => {
  const calls: string[] = [];
  const closeError = new Error("close failed");
  const removeError = new Error("remove failed");
  await assert.rejects(
    runOwnedTempCleanup([
      async () => {
        calls.push("close");
        throw closeError;
      },
      async () => {
        calls.push("remove");
        await removeOwnedTempTree("/tmp/owned", async () => {
          throw removeError;
        });
      },
    ]),
    (error) =>
      error instanceof AggregateError &&
      error.errors[0] === closeError &&
      error.errors[1] === removeError,
  );
  assert.deepEqual(calls, ["close", "remove"]);
});

test("owned temp construction cleanup retains primary and deletion errors", async () => {
  const primary = new Error("construction failed");
  const removeError = new Error("remove failed");
  await assert.rejects(
    rethrowAfterOwnedTempCleanup(primary, [
      async () =>
        await removeOwnedTempTree("/tmp/owned", async () => {
          throw removeError;
        }),
    ]),
    (error) => error === primary && primary.cause === removeError,
  );
});

test("owned temp operation cleanup does not mask its primary error", async () => {
  const primary = new Error("command failed");
  const cleanup = new Error("capture removal failed");
  await assert.rejects(
    withOwnedTempCleanup(
      async () => {
        throw primary;
      },
      async () => {
        throw cleanup;
      },
    ),
    (error) => error === primary && primary.cause === cleanup,
  );
});
