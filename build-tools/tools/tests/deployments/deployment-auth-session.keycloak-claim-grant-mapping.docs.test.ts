#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

async function read(relativePath: string) {
  return await fsp.readFile(path.join(process.cwd(), relativePath), "utf8");
}

test("deployment auth session docs stay aligned on Keycloak claim-to-grant mapping", async () => {
  const [bootstrapDoc, setupDoc, contractDoc, scenariosDoc] = await Promise.all([
    read("docs/vault-production-bootstrap.md"),
    read("docs/nixos-shared-host-setup.md"),
    read("docs/deployments-contract.md"),
    read("docs/deployment-scenarios.md"),
  ]);

  assert.match(
    bootstrapDoc,
    /deploy-submitters-<project>-<env>[\s\S]*deploy-approvers-<project>-<env>[\s\S]*deploy-admission-reporters-<project>-<env>/i,
  );
  assert.match(
    bootstrapDoc,
    /deploy-automation-<principal>-submitters-<env>[\s\S]*deploy-automation-<principal>-admission-reporters-all-deployments/i,
  );
  assert.match(
    setupDoc,
    /derive multiple grants[\s\S]*deploy-submitters-<project>-<env>[\s\S]*deploy-automation-<principal>-submitters-<env>/i,
  );
  assert.match(
    contractDoc,
    /OIDC sessions may carry multiple reviewed grants[\s\S]*repository[\s\S]*environment bound claims remain mandatory/i,
  );
  assert.match(
    scenariosDoc,
    /human-only production approval[\s\S]*CI dev auto-submit[\s\S]*CI global evidence reporting[\s\S]*CI lower-environment auto-approval/i,
  );
});
