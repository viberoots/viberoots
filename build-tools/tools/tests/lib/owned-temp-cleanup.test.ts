#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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

test("owned temp cleanup removes read-only trees produced by Nix", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "owned-read-only-"));
  const nested = path.join(root, "src");
  await fsp.mkdir(nested);
  for (let index = 0; index < 64; index += 1) {
    const dir = path.join(nested, `dir-${index}`);
    await fsp.mkdir(dir);
    await fsp.writeFile(path.join(dir, ".buckroot"), "\n");
    await fsp.chmod(path.join(dir, ".buckroot"), 0o444);
    await fsp.chmod(dir, 0o555);
  }
  await fsp.chmod(nested, 0o555);

  await removeOwnedTempTree(root);
  await assert.rejects(fsp.access(root));
});
