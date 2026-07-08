#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_BOOTSTRAP_ARGS } from "../../deployments/infisical-iac-bootstrap-config";
import {
  resolveMachineLabel,
  resolveSystemMachineLabel,
} from "../../deployments/infisical-iac-machine-label";

test("machine label prefers explicit labels, then OS short labels, then host fallback", () => {
  assert.equal(
    resolveMachineLabel(
      { ...DEFAULT_BOOTSTRAP_ARGS, machineLabel: "developer-laptop" },
      "fqdn.lan",
      "os-short",
    ),
    "developer-laptop",
  );
  assert.equal(resolveMachineLabel(DEFAULT_BOOTSTRAP_ARGS, "fqdn.lan", "os-short"), "os-short");
  assert.equal(resolveMachineLabel(DEFAULT_BOOTSTRAP_ARGS, "fqdn.lan", ""), "fqdn.lan");
  assert.equal(resolveSystemMachineLabel("freebsd"), undefined);
});
