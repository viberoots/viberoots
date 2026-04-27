#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { waitFor } from "./nixos-shared-host.control-plane.helpers.ts";

export const CONTROL_PLANE_TOKEN = "test-control-plane-token";

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

export async function enableInteractivePkceVaultRuntime(tmp: string, issuer: string) {
  const deployTargetsPath = path.join(tmp, "projects", "deployments", "pleomino-dev", "TARGETS");
  const source = await fsp.readFile(deployTargetsPath, "utf8");
  await fsp.writeFile(
    deployTargetsPath,
    source.replace(
      '    admission_policy = "//projects/deployments/pleomino-shared:dev_release",\n',
      [
        '    admission_policy = "//projects/deployments/pleomino-shared:dev_release",',
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
        '        "pkce_callback_bind_port": "7780",',
        '        "pkce_callback_bind_path": "/oidc/callback",',
        "    },",
      ].join("\n"),
    ),
    "utf8",
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
