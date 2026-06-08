#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { activateDeploymentSecretContext } from "../../deployments/deployment-secret-context";
import {
  LOCAL_FIXTURE_SERVICE_ENV,
  validateProtectedSharedServiceTransport,
} from "../../deployments/deployment-service-transport-policy";
import {
  resolveServiceClientFromFlags,
  resolveServiceClientFromManifest,
} from "../../deployments/nixos-shared-host-service-client-config";
import { withProjectConfig } from "./deployment-contexts.scope.helpers";
import { startFakeVaultServer } from "./vault.test-server";

const SECRET_REF = "secret://control-plane/mini/service-token";
const RUNTIME_REF = "runtime://github-actions/control-plane-token";

test("nixos shared-host service client resolves --remote profile URL and runtime token ref", async () => {
  await withProjectConfig(remoteProjectConfig(RUNTIME_REF), async () => {
    const client = await resolveServiceClientFromFlags({
      remote: "mini",
      context: "deploy",
      env: { DEPLOY_TOKEN: "runtime-token", VBR_DEPLOY_CONTROL_PLANE_TOKEN: "ambient-token" },
    });
    assert.equal(client.controlPlaneUrl, "https://deploy.apps.kilty.io");
    assert.equal(client.controlPlaneToken, "runtime-token");
    assert.equal(client.controlPlaneTokenRef, RUNTIME_REF);
  });
});

test("nixos shared-host service client resolves --remote secret token ref", async () => {
  await withVaultSecretContext(async () => {
    await withProjectConfig(remoteProjectConfig(SECRET_REF), async () => {
      const client = await resolveServiceClientFromFlags({
        remote: "mini",
        context: "deploy",
        env: {},
      });
      assert.equal(client.controlPlaneToken, "resolved-secret-token");
    });
  });
});

test("nixos shared-host service client reads --remote config from workspace root", async () => {
  await withTempDir("remote-profile-root-", async (workspace) => {
    await fsp.mkdir(path.join(workspace, "projects", "config"), { recursive: true });
    await fsp.writeFile(
      path.join(workspace, "projects", "config", "shared.json"),
      `${JSON.stringify({ schemaVersion: "viberoots-project-config@1", ...remoteProjectConfig(RUNTIME_REF) })}\n`,
    );
    const nested = path.join(workspace, "projects", "apps", "demo");
    await fsp.mkdir(nested, { recursive: true });
    const oldCwd = process.cwd();
    try {
      process.chdir(nested);
      const client = await resolveServiceClientFromFlags({
        workspaceRoot: workspace,
        remote: "mini",
        context: "deploy",
        env: { DEPLOY_TOKEN: "runtime-token" },
      });
      assert.equal(client.controlPlaneUrl, "https://deploy.apps.kilty.io");
      assert.equal(client.controlPlaneToken, "runtime-token");
    } finally {
      process.chdir(oldCwd);
    }
  });
});

test("nixos shared-host service client rejects --remote without a matching profile", async () => {
  await assert.rejects(
    () => resolveServiceClientFromFlags({ remote: "mini", context: "deploy", env: {} }),
    /controlPlanes\.mini profile/,
  );
});

test("nixos shared-host service client rejects malformed --remote profiles", async () => {
  for (const [profile, expected] of [
    [{}, /serviceClient is required/],
    [
      { serviceClient: { controlPlaneUrl: "https://deploy.apps.kilty.io" } },
      /controlPlaneTokenRef/,
    ],
  ] as const) {
    await withProjectConfig({ controlPlanes: { mini: profile } }, async () => {
      await assert.rejects(
        () => resolveServiceClientFromFlags({ remote: "mini", context: "deploy", env: {} }),
        expected,
      );
    });
  }
});

test("nixos shared-host service client rejects unresolvable --remote token refs", async () => {
  await withProjectConfig(remoteProjectConfig(RUNTIME_REF), async () => {
    await assert.rejects(
      () =>
        resolveServiceClientFromFlags({
          remote: "mini",
          context: "deploy",
          env: { VBR_DEPLOY_CONTROL_PLANE_TOKEN: "ambient-token" },
        }),
      /runtime control-plane token binding is unset: DEPLOY_TOKEN/,
    );
  });
});

test("nixos shared-host service client validates explicit control-plane URLs", async () => {
  assert.equal(
    (
      await resolveServiceClientFromFlags({
        controlPlaneUrl: "http://127.0.0.1:7780",
        context: "deploy",
        env: { [LOCAL_FIXTURE_SERVICE_ENV]: "1" },
      })
    ).controlPlaneUrl,
    "http://127.0.0.1:7780",
  );
  await assert.rejects(
    () =>
      resolveServiceClientFromFlags({
        controlPlaneUrl: "http://127.0.0.1:7780",
        context: "deploy",
        env: {},
      }),
    /LOCAL_FIXTURE_SERVICE/,
  );
});

test("nixos shared-host service client uses ambient URL for commands without context", async () => {
  const client = await resolveServiceClientFromFlags({
    context: "deploy status",
    env: { VBR_DEPLOY_CONTROL_PLANE_URL: " https://deploy.apps.kilty.io " },
  });
  assert.equal(client.controlPlaneUrl, "https://deploy.apps.kilty.io");
});

test("nixos shared-host service client rejects insecure protected transport", async () => {
  await assert.rejects(
    () =>
      resolveServiceClientFromFlags({
        controlPlaneUrl: "http://deploy.apps.kilty.io",
        context: "deploy",
        env: {},
      }),
    /requires HTTPS/,
  );
  assert.throws(
    () =>
      validateProtectedSharedServiceTransport({
        controlPlaneUrl: "http://127.0.0.1:7780",
        context: "deploy",
        env: {},
      }),
    /LOCAL_FIXTURE_SERVICE/,
  );
  await assert.rejects(
    () =>
      resolveServiceClientFromFlags({
        controlPlaneUrl: "https://deploy.apps.kilty.io",
        context: "deploy",
        env: { NODE_TLS_REJECT_UNAUTHORIZED: "0" },
      }),
    /TLS certificate validation/,
  );
});

test("nixos shared-host service profile requires its configured token env", () => {
  const manifest = {
    schemaVersion: "nixos-shared-host-client@1",
    tool: "nixos-shared-host-install",
    toolFingerprint: "test",
    profileName: "mini",
    destination: "mini",
    remoteRepoPath: "/srv/viberoots",
    remoteStatePath: "/etc/nixos/deployment-host/platform-state.json",
    remoteRuntimeRoot: "/var/lib/deployment-host/runtime",
    remoteRecordsRoot: "/var/lib/deployment-host/records",
    sshMode: "ssh",
    serviceClient: {
      controlPlaneUrl: "https://deploy.apps.kilty.io",
      controlPlaneTokenEnv: "VBR_DEPLOY_CONTROL_PLANE_TOKEN",
    },
    localManagedPaths: [],
  } as const;
  assert.throws(
    () => resolveServiceClientFromManifest(manifest, {}),
    /requires VBR_DEPLOY_CONTROL_PLANE_TOKEN to be set/,
  );
  assert.equal(
    resolveServiceClientFromManifest(manifest, {
      VBR_DEPLOY_CONTROL_PLANE_TOKEN: " service-token ",
    }).controlPlaneToken,
    "service-token",
  );
});

function remoteProjectConfig(tokenRef: string) {
  return {
    runtimeHosts: {
      "github-actions": {
        bindings: { "control-plane-token": { kind: "env", name: "DEPLOY_TOKEN" } },
      },
    },
    controlPlanes: {
      mini: {
        serviceClient: {
          controlPlaneUrl: "https://deploy.apps.kilty.io",
          controlPlaneTokenRef: tokenRef,
        },
        records: { backend: "service" },
      },
    },
  };
}

async function withVaultSecretContext(run: () => Promise<void>) {
  const server = await startFakeVaultServer({
    [SECRET_REF]: { currentVersion: "1", versions: { "1": { value: "resolved-secret-token" } } },
  });
  const restore = activateDeploymentSecretContext({
    kind: "vault",
    credential: { kind: "token", addr: server.addr, token: server.token },
  });
  try {
    await run();
  } finally {
    restore();
    await server.close();
  }
}

async function withTempDir(prefix: string, run: (dir: string) => Promise<void>) {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    await run(tmp);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
}
