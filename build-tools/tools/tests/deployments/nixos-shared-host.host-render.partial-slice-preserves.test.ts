#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { createNixosSharedHostPlatformState } from "../../deployments/nixos-shared-host-platform";
import { nixosSharedHostDeploymentFixture } from "./nixos-shared-host.fixture";

test("nixos-shared-host apply preserves preexisting out-of-scope apps during partial-slice scoped apply", async () => {
  await runInTemp("nixos-shared-host-partial-slice", async (tmp, $) => {
    const statePath = path.join(tmp, "nixos-shared-host-platform-state.json");
    const scopedDeploymentsPath = path.join(tmp, "scoped-deployments.json");
    const renderedPath = path.join(tmp, "nixos-shared-host.json");

    await fsp.writeFile(
      statePath,
      JSON.stringify(
        createNixosSharedHostPlatformState([
          nixosSharedHostDeploymentFixture({
            deploymentId: "other-dev",
            label: "//projects/deployments/other-dev:deploy",
            component: { kind: "static-webapp", target: "//projects/apps/other:app" },
            runtime: { appName: "other", containerPort: 4000 },
          }),
        ]),
        null,
        2,
      ),
      "utf8",
    );
    await fsp.writeFile(
      scopedDeploymentsPath,
      JSON.stringify(
        {
          version: 1,
          deployments: [nixosSharedHostDeploymentFixture()],
        },
        null,
        2,
      ),
      "utf8",
    );

    await $`node build-tools/tools/deployments/nixos-shared-host-platform-state.ts --mode scoped-apply --state ${statePath} --deployments ${scopedDeploymentsPath}`;
    await $`node build-tools/tools/deployments/nixos-shared-host-apply.ts --state ${statePath} --out ${renderedPath}`;

    const rendered = JSON.parse(await fsp.readFile(renderedPath, "utf8")) as {
      containers: Record<string, unknown>;
      nginxVirtualHosts: Record<string, unknown>;
    };
    assert.deepEqual(Object.keys(rendered.containers).sort(), ["demoapp", "other"]);
    assert.deepEqual(Object.keys(rendered.nginxVirtualHosts).sort(), [
      "demoapp.apps.kilty.io",
      "other.apps.kilty.io",
    ]);
  });
});
