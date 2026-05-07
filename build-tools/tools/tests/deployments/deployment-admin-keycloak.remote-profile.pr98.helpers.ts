#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import http from "node:http";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { resolveDeploymentFromTarget } from "../../deployments/deployment-query";
import { shouldUseServiceOwnedInteractiveAuth } from "../../deployments/deployment-service-auth-client";
import { stableBuckIsolation } from "../../lib/buck-command-env";
import { waitFor } from "./nixos-shared-host.control-plane.helpers";
import { REVIEWED_PLEOMINO_DEPLOYMENT_LABEL } from "./nixos-shared-host.deploy.remote-exec.helpers";

export const CONTROL_PLANE_TOKEN = "test-control-plane-token";
let buckQueryNonce = 0;

export function freshKeycloakBuckIsolation(tmp: string): string {
  return stableBuckIsolation(
    path.join(tmp, `.keycloak-profile-query-${++buckQueryNonce}`),
    "zxtest-keycloak-profile",
  );
}

function freshBuckQueryEnv(tmp: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    BUCK_NESTED_ISO: freshKeycloakBuckIsolation(tmp),
  };
}

export function configRootFor(tmp: string) {
  return path.join(tmp, "remote-config-root");
}

export function membershipFileFor(configRoot: string) {
  return path.join(
    configRoot,
    "deployment-host",
    "identity-provider",
    "deployment-auth-memberships.json",
  );
}

export function realmFileFor(configRoot: string) {
  return path.join(
    configRoot,
    "deployment-host",
    "identity-provider",
    "deployment-auth-realm.json",
  );
}

async function allocateLoopbackPort(): Promise<number> {
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  if (!address || typeof address === "string") {
    throw new Error("failed to allocate PKCE callback bind port");
  }
  return address.port;
}

export async function enableInteractivePkceVaultRuntime(tmp: string, issuer: string) {
  const deployTargetsPath = path.join(tmp, "projects", "deployments", "pleomino-dev", "TARGETS");
  const source = await fsp.readFile(deployTargetsPath, "utf8");
  const bindPort = await allocateLoopbackPort();
  const vaultRuntimeBlock = [
    "    vault_runtime = {",
    `        "oidc_issuer": ${JSON.stringify(issuer)},`,
    '        "audience": "deployments-vault",',
    '        "cli_public_client_id": "deployment-cli",',
    '        "deployment_environment": "mini",',
    '        "preferred_credential_source": "interactive_pkce",',
    '        "pkce_callback_mode": "public_host",',
    '        "pkce_callback_external_scheme": "https",',
    '        "pkce_callback_external_host": "deploy-auth.apps.kilty.io",',
    '        "pkce_callback_external_path": "/oidc/callback",',
    '        "pkce_callback_bind_host": "127.0.0.1",',
    `        "pkce_callback_bind_port": "${bindPort}",`,
    '        "pkce_callback_bind_path": "/oidc/callback",',
    "    },",
  ].join("\n");
  const nextSource = source.includes("vault_runtime = {")
    ? source.replace(/vault_runtime\s*=\s*\{[\s\S]*?\n\s*\},/m, vaultRuntimeBlock)
    : source.replace(
        '    admission_policy = "//projects/deployments/pleomino-shared:dev_release",\n',
        [
          '    admission_policy = "//projects/deployments/pleomino-shared:dev_release",',
          vaultRuntimeBlock,
        ].join("\n"),
      );
  if (nextSource === source) {
    throw new Error(
      "interactive PKCE vault runtime fixture update did not match pleomino-dev TARGETS",
    );
  }
  await fsp.writeFile(deployTargetsPath, nextSource, "utf8");
  const written = await fsp.readFile(deployTargetsPath, "utf8");
  assert.match(written, new RegExp(`"oidc_issuer":\\s*${JSON.stringify(issuer)}`));
  assert.match(written, /"preferred_credential_source": "interactive_pkce"/);
  assert.match(written, new RegExp(`"pkce_callback_bind_port":\\s*"${bindPort}"`));
  await waitFor(
    async () => {
      try {
        const deployment = await resolveDeploymentFromTarget(
          tmp,
          REVIEWED_PLEOMINO_DEPLOYMENT_LABEL,
          { env: freshBuckQueryEnv(tmp) },
        );
        return deployment.vaultRuntime?.oidcIssuer === issuer &&
          shouldUseServiceOwnedInteractiveAuth({ deployment })
          ? deployment
          : null;
      } catch {
        return null;
      }
    },
    "timed out waiting for deployment query to reflect interactive PKCE vault runtime",
    30_000,
  );
}

export async function completePendingAuthSession(
  controlPlaneUrl: string,
  recordsRoot: string,
  expectedStatus = 200,
) {
  const sessionState = await waitFor(
    async () => {
      const authDir = path.join(recordsRoot, "control-plane", "auth-sessions");
      let entries: string[] = [];
      try {
        entries = await fsp.readdir(authDir);
      } catch {
        return null;
      }
      for (const entry of entries) {
        if (!entry.endsWith(".json")) continue;
        try {
          const parsed = JSON.parse(await fsp.readFile(path.join(authDir, entry), "utf8")) as {
            status?: string;
            state?: string;
          };
          if (parsed.status === "pending" && parsed.state) return parsed.state;
        } catch {}
      }
      return null;
    },
    "timed out waiting for pending auth session",
    30_000,
  );
  const callbackUrl = new URL("/oidc/callback", controlPlaneUrl);
  callbackUrl.searchParams.set("code", "login-code");
  callbackUrl.searchParams.set("state", sessionState);
  const response = await fetch(callbackUrl);
  assert.equal(response.status, expectedStatus, await response.text());
}
