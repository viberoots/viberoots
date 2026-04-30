#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import {
  buildDeploymentAdminVaultDesiredState,
  checkDeploymentAdminVault,
  syncDeploymentAdminVault,
} from "../../deployments/deployment-admin-vault.ts";
import {
  cloudflarePagesApiTokenRequirements,
  cloudflarePagesDeploymentFixture,
} from "./cloudflare-pages.fixture.ts";
import { nixosSharedHostLaneGovernanceFixture } from "./deployment-lane-governance.fixture.ts";
import { nixosSharedHostLanePolicyFixture } from "./nixos-shared-host.fixture.ts";

const ADMIN_TOKEN = "test-admin-token";

function deploymentForVault(addr: string) {
  const governance = nixosSharedHostLaneGovernanceFixture({ repository: "kiltyj/common" });
  return cloudflarePagesDeploymentFixture({
    lanePolicy: nixosSharedHostLanePolicyFixture({ governance }),
    secretRequirements: cloudflarePagesApiTokenRequirements(),
    vaultRuntime: {
      addr,
      oidcIssuer: "https://identity.apps.kilty.io/realms/deployments",
      audience: "deployments-vault",
      deploymentClientId: "deployment-runner",
      serviceAccountClientId: "deployment-runner",
      deploymentEnvironment: "mini",
      roleName: "deploy-pleomino-read",
    },
  });
}

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as Record<string, unknown>;
}

async function startFakeVault() {
  const state = {
    config: {
      oidc_discovery_url: "https://identity.apps.kilty.io/realms/deployments",
      bound_issuer: "https://identity.apps.kilty.io/realms/deployments",
    },
    role: {
      role_type: "jwt",
      user_claim: "sub",
      bound_audiences: ["deployments-vault"],
      bound_claims: {
        azp: "deployment-runner",
        deployment_environment: "mini",
        repository: "kiltyj/bucknix-fresh",
      },
      token_policies: ["deploy-pleomino-read"],
    },
    policy: "",
    writes: [] as string[],
  };
  const server = http.createServer(async (req, res) => {
    if (req.headers["x-vault-token"] !== ADMIN_TOKEN) {
      res.writeHead(403, { "content-type": "application/json" });
      res.end(JSON.stringify({ errors: ["permission denied"] }));
      return;
    }
    const url = new URL(req.url || "/", "http://vault.test");
    if (req.method === "GET" && url.pathname === "/v1/auth/jwt/config") {
      res.end(JSON.stringify({ data: state.config }));
      return;
    }
    if (req.method === "POST" && url.pathname === "/v1/auth/jwt/config") {
      state.writes.push("config");
      state.config = { ...(await readJson(req)) } as typeof state.config;
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method === "GET" && url.pathname === "/v1/auth/jwt/role/deploy-pleomino-read") {
      res.end(JSON.stringify({ data: state.role }));
      return;
    }
    if (req.method === "POST" && url.pathname === "/v1/auth/jwt/role/deploy-pleomino-read") {
      state.writes.push("role");
      const body = await readJson(req);
      state.role = {
        role_type: String(body.role_type),
        user_claim: String(body.user_claim),
        bound_audiences: body.bound_audiences as string[],
        bound_claims: body.bound_claims as typeof state.role.bound_claims,
        token_policies: body.token_policies as string[],
      };
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method === "GET" && url.pathname === "/v1/sys/policies/acl/deploy-pleomino-read") {
      res.end(JSON.stringify({ data: { policy: state.policy } }));
      return;
    }
    if (req.method === "PUT" && url.pathname === "/v1/sys/policies/acl/deploy-pleomino-read") {
      state.writes.push("policy");
      state.policy = String((await readJson(req)).policy || "");
      res.writeHead(204);
      res.end();
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ errors: ["not found"] }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    state,
    addr: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test("deploy admin vault desired state derives bound claims from reviewed deployment metadata", async () => {
  const vault = await startFakeVault();
  try {
    const desired = buildDeploymentAdminVaultDesiredState(deploymentForVault(vault.addr));
    assert.deepEqual(desired.boundClaims, {
      azp: "deployment-runner",
      deployment_environment: "mini",
      repository: "kiltyj/common",
    });
    assert.match(desired.policyHcl, /secret\/data\/deployments\/pleomino\/cloudflare_api_token/);
    assert.match(
      desired.policyHcl,
      /secret\/metadata\/deployments\/pleomino\/cloudflare_api_token/,
    );
  } finally {
    await vault.close();
  }
});

test("deploy admin vault check reports live role drift without mutating Vault", async () => {
  const vault = await startFakeVault();
  try {
    const result = await checkDeploymentAdminVault({
      deployment: deploymentForVault(vault.addr),
      env: { VAULT_TOKEN: ADMIN_TOKEN },
    });
    assert.equal(result.inSync, false);
    assert.deepEqual(result.driftSummary, ["policy.policy", "role.bound_claims"]);
    assert.deepEqual(vault.state.writes, []);
  } finally {
    await vault.close();
  }
});

test("deploy admin vault sync repairs policy and JWT role drift idempotently", async () => {
  const vault = await startFakeVault();
  try {
    const deployment = deploymentForVault(vault.addr);
    const first = await syncDeploymentAdminVault({
      deployment,
      env: { VAULT_TOKEN: ADMIN_TOKEN },
    });
    assert.equal(first.changed, true);
    assert.equal(first.inSync, true);
    assert.deepEqual(vault.state.role.bound_claims.repository, "kiltyj/common");
    assert.deepEqual(vault.state.writes, ["config", "policy", "role"]);

    vault.state.writes.length = 0;
    const second = await syncDeploymentAdminVault({
      deployment,
      env: { VAULT_TOKEN: ADMIN_TOKEN },
    });
    assert.equal(second.changed, false);
    assert.equal(second.inSync, true);
    assert.deepEqual(vault.state.writes, []);
  } finally {
    await vault.close();
  }
});
