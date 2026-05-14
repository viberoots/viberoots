#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkDeploymentAdminInfisical } from "../../deployments/deployment-admin-infisical";
import { infisicalAdminDeployment, infisicalAdminEnv } from "./deployment-admin-infisical.fixture";
import {
  infisicalRequirement,
  infisicalSecret,
  restoreInfisicalTestEnv,
} from "./deployment-secret-infisical.fixture";
import { startFakeInfisicalServer } from "./infisical.test-server";

const AUTH = {
  clientId: "id",
  clientSecret: "client-secret-leak-sentinel",
  accessToken: "access-token-leak-sentinel",
};

test("Infisical admin check verifies project, identity access, environment, and metadata", async () => {
  const server = await startFakeInfisicalServer(AUTH, [infisicalSecret()]);
  try {
    const result = await checkDeploymentAdminInfisical({
      deployment: await infisicalAdminDeployment(server.siteUrl),
      env: infisicalAdminEnv(),
    });
    assert.equal(result.schemaVersion, "deploy-admin-infisical-check@1");
    assert.equal(result.inSync, true);
    assert.deepEqual(
      result.diagnostics.map((entry) => entry.status),
      ["ok", "ok", "ok", "ok"],
    );
    assert.deepEqual(result.diagnostics[2]?.permissionEvidence, {
      access: true,
      permissions: ["secrets:read"],
      evidence: "project-membership:member",
    });
    assert.ok(server.secretCalls.includes("cloudflare_api_token:false:"));
    assert.doesNotMatch(
      JSON.stringify(result),
      /client-secret-leak-sentinel|access-token-leak-sentinel/,
    );
  } finally {
    restoreInfisicalTestEnv();
    await server.close();
  }
});

test("Infisical admin check reports missing project, environment, secret, and credential env", async () => {
  const missingProject = await startFakeInfisicalServer(AUTH, [infisicalSecret()], {
    missingProject: true,
  });
  try {
    const projectResult = await checkDeploymentAdminInfisical({
      deployment: await infisicalAdminDeployment(missingProject.siteUrl),
      env: infisicalAdminEnv(),
    });
    assert.equal(projectResult.inSync, false);
    assert.equal(projectResult.diagnostics[0]?.status, "missing");
  } finally {
    await missingProject.close();
  }
  const missingEnvironment = await startFakeInfisicalServer(AUTH, [infisicalSecret()], {
    missingEnvironment: true,
  });
  try {
    const environmentResult = await checkDeploymentAdminInfisical({
      deployment: await infisicalAdminDeployment(missingEnvironment.siteUrl),
      env: infisicalAdminEnv(),
    });
    assert.equal(environmentResult.diagnostics[1]?.status, "missing");
  } finally {
    await missingEnvironment.close();
  }
  const missingSecret = await startFakeInfisicalServer(AUTH);
  try {
    const secretResult = await checkDeploymentAdminInfisical({
      deployment: await infisicalAdminDeployment(missingSecret.siteUrl),
      env: infisicalAdminEnv(),
    });
    assert.equal(secretResult.diagnostics[3]?.status, "missing");
    const credentialResult = await checkDeploymentAdminInfisical({
      deployment: await infisicalAdminDeployment(missingSecret.siteUrl),
      env: {},
    });
    assert.equal(credentialResult.diagnostics[0]?.kind, "credential_env");
    assert.equal(credentialResult.diagnostics[0]?.status, "missing");
  } finally {
    await missingSecret.close();
  }
});

test("Infisical admin check accepts reviewed placeholder approvals", async () => {
  const server = await startFakeInfisicalServer(AUTH);
  try {
    const deployment = await infisicalAdminDeployment(server.siteUrl);
    const result = await checkDeploymentAdminInfisical({
      deployment: {
        ...deployment,
        infisicalSecretMappings: {
          [infisicalRequirement.contractId]: {
            secretPath: "/deployments/pleomino",
            secretName: "cloudflare_api_token",
            approvedPlaceholder: true,
            placeholderReason: "operator approved before first live value",
          },
        },
      },
      env: infisicalAdminEnv(),
    });
    assert.equal(result.inSync, true);
    assert.equal(result.diagnostics[3]?.status, "ok");
    assert.equal(result.diagnostics[3]?.placeholderApproved, true);
    assert.equal(
      result.diagnostics[3]?.placeholderReason,
      "operator approved before first live value",
    );
  } finally {
    await server.close();
  }
});

test("Infisical admin check reports identity access evidence gaps", async () => {
  const denied = await startFakeInfisicalServer(AUTH, [infisicalSecret()], {
    machineIdentityAccess: false,
  });
  try {
    const result = await checkDeploymentAdminInfisical({
      deployment: await infisicalAdminDeployment(denied.siteUrl),
      env: infisicalAdminEnv(),
    });
    assert.equal(result.inSync, false);
    assert.equal(result.diagnostics[2]?.kind, "machine_identity_project_access");
    assert.equal(result.diagnostics[2]?.status, "missing");
    assert.deepEqual(result.diagnostics[2]?.permissionEvidence, {
      access: false,
      permissions: ["secrets:read"],
      evidence: "project-membership:member",
    });
  } finally {
    await denied.close();
  }
  const unsupported = await startFakeInfisicalServer(AUTH, [infisicalSecret()], {
    machineIdentityAccessStatus: 501,
  });
  try {
    const result = await checkDeploymentAdminInfisical({
      deployment: await infisicalAdminDeployment(unsupported.siteUrl),
      env: infisicalAdminEnv(),
    });
    assert.equal(result.diagnostics[2]?.status, "unsupported");
    assert.match(
      String(result.diagnostics[2]?.evidenceUnavailableReason),
      /unsupported|did not expose/i,
    );
  } finally {
    await unsupported.close();
  }
});

test("Infisical admin check reports insufficient access without leaking credentials", async () => {
  const server = await startFakeInfisicalServer(AUTH, [
    infisicalSecret({ status: 403, errorBody: { error: "denied" } }),
  ]);
  try {
    const result = await checkDeploymentAdminInfisical({
      deployment: await infisicalAdminDeployment(server.siteUrl),
      env: infisicalAdminEnv(),
    });
    assert.equal(result.inSync, false);
    assert.equal(result.diagnostics[3]?.status, "error");
    assert.match(String(result.diagnostics[3]?.message), /Infisical secret read failed: 403/);
    assert.doesNotMatch(
      JSON.stringify(result),
      /client-secret-leak-sentinel|access-token-leak-sentinel/,
    );
  } finally {
    await server.close();
  }
});

test("Infisical admin diagnostics redact auth failure secret material", async () => {
  const secrets = [
    "client-secret-leak-sentinel",
    "access-token-leak-sentinel",
    "personal-token-leak-sentinel",
    "secret-value-leak-sentinel",
    "expanded-reference-leak-sentinel",
  ];
  const server = await startFakeInfisicalServer(
    {
      ...AUTH,
      status: 401,
      echoClientSecretOnFailure: true,
      failureBody: {
        accessToken: secrets[1],
        personalToken: secrets[2],
        secretValue: secrets[3],
        expandedReference: secrets[4],
      },
    },
    [infisicalSecret()],
  );
  try {
    const result = await checkDeploymentAdminInfisical({
      deployment: await infisicalAdminDeployment(server.siteUrl),
      env: infisicalAdminEnv(),
    });
    assert.equal(result.inSync, false);
    assert.equal(result.diagnostics[0]?.status, "error");
    const serialized = JSON.stringify(result);
    for (const secret of secrets) assert.doesNotMatch(serialized, new RegExp(secret));
  } finally {
    await server.close();
  }
});

test("Infisical admin diagnostics redact live API error secret material", async () => {
  const secrets = [
    "client-secret-leak-sentinel",
    "access-token-leak-sentinel",
    "personal-token-leak-sentinel",
    "secret-value-leak-sentinel",
    "expanded-reference-leak-sentinel",
  ];
  const server = await startFakeInfisicalServer(AUTH, [
    infisicalSecret({
      status: 403,
      errorBody: {
        accessToken: secrets[1],
        personalToken: secrets[2],
        secretValue: secrets[3],
        expandedReference: secrets[4],
      },
    }),
  ]);
  try {
    const result = await checkDeploymentAdminInfisical({
      deployment: await infisicalAdminDeployment(server.siteUrl),
      env: infisicalAdminEnv(),
    });
    assert.equal(result.diagnostics[3]?.status, "error");
    const serialized = JSON.stringify(result);
    for (const secret of secrets) assert.doesNotMatch(serialized, new RegExp(secret));
  } finally {
    await server.close();
  }
});
