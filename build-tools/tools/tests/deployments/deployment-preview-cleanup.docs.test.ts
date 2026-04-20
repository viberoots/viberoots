#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

test("preview cleanup docs stay inside the admitted secret boundary", async () => {
  const contractDoc = await fsp.readFile(
    path.join(process.cwd(), "docs", "deployments-contract.md"),
    "utf8",
  );
  assert.match(
    contractDoc,
    /preview cleanup[\s\S]*admitted `secret_requirements`[\s\S]*ambient provider-token/,
  );
});
