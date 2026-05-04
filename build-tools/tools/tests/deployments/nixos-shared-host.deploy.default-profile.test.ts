#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { LOCAL_FIXTURE_SERVICE_ENV } from "../../deployments/deployment-service-transport-policy";
import { runInTemp } from "../lib/test-helpers";
import {
  installNixosSharedHostTargets,
  nixosSharedHostDeploymentFixture,
  nixosSharedHostLanePolicyFixture,
} from "./nixos-shared-host.fixture";

async function installClientProfile($: any, profileRoot: string): Promise<void> {
  process.env[LOCAL_FIXTURE_SERVICE_ENV] = "1";
  await $({
    env: { ...process.env, [LOCAL_FIXTURE_SERVICE_ENV]: "1" },
  })`zx-wrapper build-tools/tools/deployments/nixos-shared-host-install.ts client install --output-root ${profileRoot} --profile mini --destination mini --remote-repo-path /srv/common --remote-state-path /etc/nixos/deployment-host/platform-state.json --remote-runtime-root /var/lib/deployment-host/runtime --remote-records-root /var/lib/deployment-host/records --ssh-mode ssh --control-plane-url http://127.0.0.1:7780`;
}

test("public deploy plan uses lane default client profile when --profile is omitted", async () => {
  await runInTemp("nixos-shared-host-remote-plan-default-profile", async (tmp, $) => {
    const deployment = nixosSharedHostDeploymentFixture({
      lanePolicy: nixosSharedHostLanePolicyFixture({ defaultClientProfile: "mini" }),
    });
    await installNixosSharedHostTargets(tmp, [deployment]);
    const profileRoot = `${tmp}/profiles`;
    await installClientProfile($, profileRoot);
    const result =
      await $`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment ${deployment.label} --profile-root ${profileRoot} --dry-run`;
    assert.equal(JSON.parse(String(result.stdout)).profileName, "mini");
  });
});
