#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { test } from "node:test";
import { parseBootstrapArgs } from "../../deployments/infisical-iac-bootstrap-args";
import { DEFAULT_BOOTSTRAP_ARGS } from "../../deployments/infisical-iac-bootstrap-config";
import { getAccessToken } from "../../deployments/infisical-iac-bootstrap-auth";
import {
  orgIdByExactName,
  organizationListReason,
  resolveOrganizationId,
} from "../../deployments/infisical-iac-bootstrap-org";
import type { CommandRunner } from "../../deployments/infisical-iac-bootstrap-types";

test("bootstrap args default to the reviewed Pleomino Infisical host and saved-plan apply", () => {
  const args = parseBootstrapArgs([]);
  assert.equal(args.apiUrl, "https://app.infisical.com");
  assert.equal(args.cliDomain, "https://app.infisical.com/api");
  assert.equal(args.noTofuApply, false);
});

test("bootstrap args support host shorthands and non-interactive controls", () => {
  const args = parseBootstrapArgs([
    "--infisical-host",
    "eu",
    "--no-login",
    "--access-token-env",
    "TOKEN_ENV",
    "--organization-id",
    "org_1",
    "--tofu-plan-file",
    ".local/plan.tfplan",
    "--no-tofu-apply",
    "--rotate-deployment-credentials",
    "--yes",
  ]);
  assert.equal(args.apiUrl, "https://eu.infisical.com");
  assert.equal(args.cliDomain, "https://eu.infisical.com/api");
  assert.equal(args.accessTokenEnv, "TOKEN_ENV");
  assert.equal(args.organizationId, "org_1");
  assert.equal(args.noTofuApply, true);
  assert.equal(args.rotateDeploymentCredentials, true);
  assert.equal(args.yes, true);
});

test("bootstrap args reject ambiguous organization selectors", () => {
  assert.throws(
    () => parseBootstrapArgs(["--organization-id", "org_1", "--org-name", "viberoots"]),
    /use only one/,
  );
});

test("organization exact-name selection and non-interactive remediation include org names", () => {
  const orgs = [
    { id: "org_1", name: "viberoots" },
    { id: "org_2", name: "personal" },
  ];
  assert.equal(orgIdByExactName(orgs, "viberoots"), "org_1");
  assert.match(organizationListReason(orgs), /viberoots \(org_1\)/);
  assert.match(organizationListReason(orgs), /personal \(org_2\)/);
  assert.throws(() => orgIdByExactName(orgs, "missing"), /no accessible/);
});

test("organization selection auto-selects one accessible org with --yes", async () => {
  const api = fakeOrgApi([{ id: "org_1", name: "viberoots" }]);
  const orgId = await resolveOrganizationId(api as never, { ...DEFAULT_BOOTSTRAP_ARGS, yes: true });
  assert.equal(orgId, "org_1");
});

test("organization selection accepts an interactive numbered choice", async () => {
  const api = fakeOrgApi([
    { id: "org_1", name: "personal" },
    { id: "org_2", name: "viberoots" },
  ]);
  const orgId = await resolveOrganizationId(api as never, DEFAULT_BOOTSTRAP_ARGS, {
    stdin: { isTTY: true } as NodeJS.ReadStream,
    stdout: { isTTY: true } as NodeJS.WriteStream,
    question: async () => "2",
  });
  assert.equal(orgId, "org_2");
});

test("organization selection fails non-interactively with org names and remediation", async () => {
  const api = fakeOrgApi([
    { id: "org_1", name: "personal" },
    { id: "org_2", name: "viberoots" },
  ]);
  await assert.rejects(
    () =>
      resolveOrganizationId(api as never, DEFAULT_BOOTSTRAP_ARGS, {
        stdin: { isTTY: false } as NodeJS.ReadStream,
        stdout: { isTTY: false } as NodeJS.WriteStream,
      }),
    /personal \(org_1\)[\s\S]*viberoots \(org_2\)[\s\S]*--org-name or --organization-id/,
  );
});

test("CLI login uses isolated HOME and removes local state after token extraction", async () => {
  let observedHome = "";
  const runner: CommandRunner = ({ args, env }) => {
    observedHome = String(env?.HOME || "");
    if (args.includes("login")) return "";
    return "human-token\n";
  };
  const result = await getAccessToken({ ...DEFAULT_BOOTSTRAP_ARGS }, runner, {});
  assert.equal(result.token, "human-token");
  assert.match(observedHome, /infisical-iac-bootstrap-home-/);
  await assert.rejects(() => fs.stat(observedHome), /ENOENT/);
});

test("--no-login fails fast when the configured env var is missing", async () => {
  await assert.rejects(
    () => getAccessToken({ ...DEFAULT_BOOTSTRAP_ARGS, noLogin: true }, () => "", {}),
    /missing Infisical access token env var/,
  );
});

function fakeOrgApi(orgs: Array<{ id: string; name: string }>) {
  return { request: async () => ({ organizations: orgs }) };
}
