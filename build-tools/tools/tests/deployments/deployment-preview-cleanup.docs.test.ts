#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";
import { viberootsRepoPath } from "./deployment-command";

test("preview cleanup docs stay inside the admitted secret boundary", async () => {
  const contractDoc = await fsp.readFile(viberootsRepoPath("docs/deployments-contract.md"), "utf8");
  assert.match(
    contractDoc,
    /preview cleanup[\s\S]*admitted `secret_requirements`[\s\S]*ambient provider-token/,
  );
});
