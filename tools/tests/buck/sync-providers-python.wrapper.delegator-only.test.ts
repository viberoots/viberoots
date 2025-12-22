#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import * as fsp from "node:fs/promises";

async function read(file: string) {
  return await fsp.readFile(file, "utf8");
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

test("sync-providers-python.ts is delegator-only (no provider internals, no custom flag parsing)", async () => {
  const f = "tools/buck/sync-providers-python.ts";
  const txt = await read(f);

  assert(
    txt.includes("tools/buck/sync-providers.ts"),
    `${f} must delegate to tools/buck/sync-providers.ts`,
  );
  assert(
    !txt.includes("./providers/"),
    `${f} must not import provider internals (./providers/...)`,
  );
  assert(!txt.includes("syncPythonProviders"), `${f} must not call syncPythonProviders directly`);
  assert(
    !txt.includes("getFlag") && !txt.includes("hasFlag"),
    `${f} must not implement its own flag parsing; it should forward args`,
  );
});
