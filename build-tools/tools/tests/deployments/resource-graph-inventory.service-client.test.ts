#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";
import { createDeploymentResourceInventory } from "../../deployments/resource-graph-inventory";
import {
  rejectedServiceClientSelectionRecord,
  resolvedServiceClientSelectionRecord,
} from "../../deployments/resource-graph-service-client";
import { resolveProtectedSharedServiceClient } from "../../deployments/deployment-service-client-selection";
import { installNixosSharedHostClient } from "../../deployments/nixos-shared-host-install-dev-machine";
import { cloudflarePagesDeploymentFixture } from "./cloudflare-pages.fixture";
import { withProjectConfig } from "./deployment-contexts.scope.helpers";

const RUNTIME_REF = "runtime://github-actions/control-plane-token";

test("service-client inventory records actual selection and rejection paths", async () => {
  await withProjectConfig(remoteProjectConfig(), async () => {
    const records = [];
    const context = await resolveProtectedSharedServiceClient({
      deployment: deployment(),
      context: "deploy",
      env: { DEPLOY_TOKEN: "context-token" },
    });
    records.push(
      resolvedServiceClientSelectionRecord({ id: "context", source: "context", client: context }),
    );
    const override = await resolveProtectedSharedServiceClient({
      deployment: deployment(),
      controlPlaneUrl: "https://override.example",
      allowControlPlaneOverride: true,
      context: "deploy",
      env: { DEPLOY_TOKEN: "override-token" },
    });
    records.push(
      resolvedServiceClientSelectionRecord({
        id: "explicit-override",
        source: "explicit_override",
        client: override,
      }),
    );
    const noContext = cloudflarePagesDeploymentFixture({ controlPlane: undefined });
    const remote = await resolveProtectedSharedServiceClient({
      deployment: noContext,
      remote: "mini",
      context: "deploy",
      env: { DEPLOY_TOKEN: "remote-token" },
    });
    records.push(
      resolvedServiceClientSelectionRecord({ id: "remote-mini", source: "remote", client: remote }),
    );
    records.push(
      await rejected("remote-missing", () =>
        resolveProtectedSharedServiceClient({
          deployment: noContext,
          remote: "missing",
          context: "deploy",
          env: {},
        }),
      ),
    );
    records.push(
      await rejected("remote-context", () =>
        resolveProtectedSharedServiceClient({
          deployment: deployment(),
          remote: "mini",
          context: "deploy",
          env: { DEPLOY_TOKEN: "token" },
        }),
      ),
    );
    const explicit = await resolveProtectedSharedServiceClient({
      deployment: noContext,
      controlPlaneUrl: "https://explicit.example",
      controlPlaneToken: "token",
      context: "deploy",
      env: {},
    });
    records.push(
      resolvedServiceClientSelectionRecord({
        id: "explicit",
        source: "explicit",
        client: explicit,
      }),
    );
    const ambient = await resolveProtectedSharedServiceClient({
      deployment: noContext,
      context: "deploy",
      env: {
        VBR_DEPLOY_CONTROL_PLANE_URL: "https://ambient.example",
        VBR_DEPLOY_CONTROL_PLANE_TOKEN: "ambient-token",
      },
    });
    records.push(
      resolvedServiceClientSelectionRecord({ id: "ambient", source: "ambient", client: ambient }),
    );
    const profileRoot = await installProfile("mini");
    await withArgv(["--profile", "mini", "--profile-root", profileRoot], async () => {
      const profile = await resolveProtectedSharedServiceClient({
        deployment: noContext,
        context: "deploy",
        env: { PROFILE_TOKEN: "profile-token" },
      });
      records.push(
        resolvedServiceClientSelectionRecord({
          id: "profile-mini",
          source: "profile",
          client: profile,
          profileName: "mini",
          profileRoot,
        }),
      );
    });
    await withArgv(["--profile-root", profileRoot], async () => {
      const laneDefault = await resolveProtectedSharedServiceClient({
        deployment: cloudflarePagesDeploymentFixture({
          controlPlane: undefined,
          lanePolicy: { ...noContext.lanePolicy, defaultClientProfile: "mini" },
        }),
        context: "deploy",
        env: { PROFILE_TOKEN: "profile-token" },
      });
      records.push(
        resolvedServiceClientSelectionRecord({
          id: "lane-default",
          source: "lane_policy_default",
          client: laneDefault,
          profileName: "mini",
          profileRoot,
          defaultedFromLanePolicy: true,
        }),
      );
    });
    records.push(
      resolvedServiceClientSelectionRecord({
        id: "token-env",
        source: "token_env",
        client: ambient,
        tokenEnv: "VBR_DEPLOY_CONTROL_PLANE_TOKEN",
      }),
    );
    const inventory = createDeploymentResourceInventory([], {
      runtimeSources: { serviceClientSelections: records },
    });
    assert.deepEqual(inventory.errors, []);
    assert.equal(JSON.stringify(inventory.resources).includes("profile-token"), false);
    assert.deepEqual(
      inventory.resources
        .filter((resource) => resource.kind === "ServiceClientProfile")
        .map((resource) => resource.facts?.source)
        .sort(),
      "ambient,context,explicit,explicit_override,lane_policy_default,profile,remote,remote,remote,token_env".split(
        ",",
      ),
    );
  });
  const invalidRecords = [] as Awaited<ReturnType<typeof rejected>>[];
  await withProjectConfig(invalidRemoteProjectConfig(), async () =>
    invalidRecords.push(
      await rejected("remote-invalid", () =>
        resolveProtectedSharedServiceClient({
          deployment: cloudflarePagesDeploymentFixture({ controlPlane: undefined }),
          remote: "invalid",
          context: "deploy",
        }),
      ),
    ),
  );
  const inventory = createDeploymentResourceInventory([], {
    runtimeSources: { serviceClientSelections: invalidRecords },
  });
  assert.deepEqual(inventory.errors, []);
  const evidence = inventory.resources.find((resource) => resource.id === "remote-invalid");
  assert.equal(evidence?.facts?.status, "rejected");
  assert.match(String(evidence?.facts?.diagnostic), /controlPlaneTokenRef must be/);
});

function deployment() {
  const controlPlane = {
    name: "prod",
    serviceClient: {
      controlPlaneUrl: "https://control.prod.example",
      controlPlaneTokenRef: RUNTIME_REF,
    },
  };
  return cloudflarePagesDeploymentFixture({
    controlPlane,
    deploymentContext: { name: "prod", controlPlane },
  });
}

function remoteProjectConfig() {
  return {
    runtimeHosts: {
      "github-actions": {
        bindings: { "control-plane-token": { kind: "env", name: "DEPLOY_TOKEN" } },
      },
    },
    controlPlanes: {
      mini: {
        serviceClient: {
          controlPlaneUrl: "https://remote.example",
          controlPlaneTokenRef: RUNTIME_REF,
        },
      },
    },
  };
}

// prettier-ignore
const invalidRemoteProjectConfig = () => ({ controlPlanes: { invalid: { serviceClient: { controlPlaneUrl: "https://invalid.example", controlPlaneTokenRef: "raw-token" } } } });

async function rejected(id: string, run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    return rejectedServiceClientSelectionRecord({ id, source: "remote", error });
  }
  throw new Error(`${id} unexpectedly resolved`);
}

async function installProfile(profileName: string) {
  const profileRoot = "profiles";
  await fsp.rm(profileRoot, { recursive: true, force: true });
  await installNixosSharedHostClient({
    outputRoot: profileRoot,
    toolFingerprint: "test",
    input: {
      profileName,
      destination: profileName,
      remoteRepoPath: "/srv/viberoots",
      remoteStatePath: "/var/lib/state.json",
      remoteRuntimeRoot: "/var/lib/runtime",
      remoteRecordsRoot: "/var/lib/records",
      sshMode: "ssh",
      controlPlaneUrl: "https://profile.example",
      controlPlaneTokenEnv: "PROFILE_TOKEN",
    },
  });
  return profileRoot;
}

async function withArgv(args: string[], run: () => Promise<void>) {
  const oldArgv = process.argv;
  process.argv = ["node", "test", ...args];
  await run().finally(() => (process.argv = oldArgv));
}
