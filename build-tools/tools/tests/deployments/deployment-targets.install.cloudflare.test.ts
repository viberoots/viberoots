#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import {
  cloudflarePagesDeploymentFixture,
  installCloudflarePagesTargets,
} from "./cloudflare-pages.fixture";

test("Cloudflare target install preserves reviewed vault runtime metadata", async () => {
  await runInTemp("deployment-targets-install-cloudflare-vault-runtime", async (tmp) => {
    const deployment = cloudflarePagesDeploymentFixture({
      vaultRuntime: {
        addr: "https://secrets.apps.kilty.io:8200",
        oidcIssuer: "https://identity.apps.kilty.io/realms/deployments",
        audience: "deployments-vault",
        deploymentClientId: "deployment-runner",
        cliPublicClientId: "deployment-cli",
        serviceAccountClientId: "deployment-runner",
        deploymentEnvironment: "mini",
        roleName: "deploy-pleomino-read",
        clientSecretEnv: "VBR_DEPLOYER_CLIENT_SECRET",
        jenkinsClientSecretEnv: "JENKINS_DEPLOYMENT_CLIENT_SECRET",
        pkceCallback: {
          mode: "public_host",
          externalScheme: "https",
          externalHost: "deploy-auth.apps.kilty.io",
          externalPath: "/oidc/callback",
          bindHost: "127.0.0.1",
          bindPort: "7780",
          bindPath: "/oidc/callback",
          openFirewall: false,
        },
      },
    });

    await installCloudflarePagesTargets(tmp, [deployment]);

    const targets = await fsp.readFile(
      path.join(tmp, "projects", "deployments", "pleomino", "staging", "TARGETS"),
      "utf8",
    );
    for (const expected of [
      '"cli_public_client_id": "deployment-cli"',
      '"service_account_client_id": "deployment-runner"',
      '"jenkins_client_secret_env": "JENKINS_DEPLOYMENT_CLIENT_SECRET"',
      '"pkce_callback_mode": "public_host"',
      '"pkce_callback_external_host": "deploy-auth.apps.kilty.io"',
      '"pkce_callback_bind_port": "7780"',
      '"pkce_callback_open_firewall": "false"',
    ]) {
      assert.ok(targets.includes(expected), `expected generated TARGETS to include ${expected}`);
    }
  });
});
