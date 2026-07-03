#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { test } from "node:test";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

test("remote enablement checklist keeps future remote lanes explicit", async () => {
  const doc = await fs.readFile(
    viberootsSourcePath("viberoots/build-tools/docs/remote-build-setup.md"),
    "utf8",
  );
  const section = doc.split("### Local Conformance Checklist")[1] || "";

  assert.match(section, /Provision RE, CAS, and action-cache endpoints/);
  assert.match(section, /worker has no ambient checkout dependency/);
  assert.match(section, /Nix paths substitute or materialize/);
  assert.match(section, /logs contain no secrets/);
  assert.match(section, /macOS lane reporting parity/);
  assert.match(section, /Do not add a default Jenkins remote lane/);
  assert.match(section, /self-managed operations control plane is deferred/);
  assert.match(section, /Buck2 remains the action scheduler/);
  assert.doesNotMatch(section, /VBR_REMOTE_EXEC_MODE=/);
});
