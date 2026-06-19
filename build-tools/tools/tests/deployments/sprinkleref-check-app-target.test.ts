#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { test } from "node:test";
import { collectTargetRefs } from "../../deployments/sprinkleref-check-target";
import { runInTemp } from "../lib/test-helpers";

test("app target check discovers deployment metadata that references the app", async () => {
  await runInTemp("sprinkleref-check-app-target", async (tmp) => {
    await writeAppAndDeployment(tmp);
    const refs = await collectTargetRefs({
      cwd: tmp,
      target: "//projects/apps/check-app:app",
      deps: "transitive",
    });
    assert.deepEqual(
      refs.map((entry) => [entry.ref, entry.scope, entry.requiredBy, entry.locations[0]]),
      [
        [
          "secret://deployments/check-app/api_token",
          "direct",
          "//projects/deployments/check-app-dev:deploy",
          "projects/deployments/check-app-dev/TARGETS:10",
        ],
      ],
    );
  });
});

async function writeAppAndDeployment(tmp: string): Promise<void> {
  const appDir = path.join(tmp, "projects", "apps", "check-app");
  const deployDir = path.join(tmp, "projects", "deployments", "check-app-dev");
  await fs.mkdir(appDir, { recursive: true });
  await fs.mkdir(deployDir, { recursive: true });
  await fs.writeFile(
    path.join(appDir, "TARGETS"),
    [
      'load("@prelude//:rules.bzl", "genrule")',
      "",
      "genrule(",
      '    name = "app",',
      '    out = "app.txt",',
      '    cmd = "printf app > $OUT",',
      '    visibility = ["PUBLIC"],',
      ")",
      "",
    ].join("\n"),
  );
  await fs.writeFile(
    path.join(deployDir, "TARGETS"),
    [
      'load("@viberoots//build-tools/deployments:metadata_rules.bzl", "deployment_target")',
      "",
      "deployment_target(",
      '    name = "deploy",',
      '    provider = "test",',
      '    component = "//projects/apps/check-app:app",',
      '    component_kind = "test",',
      '    publisher = "test",',
      "    secret_requirements = [",
      '        {"name": "api_token", "step": "publish", "contract_id": "secret://deployments/check-app/api_token", "required": "true"},',
      "    ],",
      '    visibility = ["PUBLIC"],',
      ")",
      "",
    ].join("\n"),
  );
}
