#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { test } from "node:test";
import { parseBootstrapArgs, usage } from "../../deployments/infisical-iac-bootstrap-args";
import { DEFAULT_BOOTSTRAP_ARGS } from "../../deployments/infisical-iac-bootstrap-config";
import { runInfisicalBootstrapMain } from "../../deployments/infisical-iac-bootstrap";
import { getAccessToken, spawnCommandRunner } from "../../deployments/infisical-iac-bootstrap-auth";
import {
  orgIdByExactName,
  organizationListReason,
  resolveOrganizationId,
} from "../../deployments/infisical-iac-bootstrap-org";
import type { CommandRunner } from "../../deployments/infisical-iac-bootstrap-types";

test("bootstrap args require an explicit mode", () => {
  assert.throws(() => parseBootstrapArgs([]), /use exactly one bootstrap mode/);
});

test("bootstrap usage prints the selected operator command surface", () => {
  const text = usage();
  assert.match(text, /build-tools\/tools\/deployments\/infisical-bootstrap\.ts repo --dry-run/);
  assert.match(text, /build-tools\/tools\/deployments\/infisical-bootstrap\.ts repo --yes/);
  assert.match(
    text,
    /build-tools\/tools\/deployments\/infisical-bootstrap\.ts repo --without-deployments/,
  );
  assert.match(text, /--apply-metadata-patch/);
  assert.match(
    text,
    /build-tools\/tools\/deployments\/infisical-bootstrap\.ts deployment --target <buck-target> --dry-run/,
  );
  assert.match(
    text,
    /build-tools\/tools\/deployments\/infisical-bootstrap\.ts deployment --target <buck-target> --yes/,
  );
  assert.doesNotMatch(text, /infisical-iac-bootstrap\.ts/);
});

test("bootstrap main help prints usage before required mode parsing", async () => {
  for (const helpFlag of ["--help", "-h"]) {
    const output: string[] = [];
    await runInfisicalBootstrapMain({
      argv: [helpFlag],
      stdout: (text) => output.push(text),
      stderr: () => assert.fail("help must not print an error"),
      exit: () => assert.fail("help must not exit"),
    });
    const text = output.join("\n");
    assert.match(text, /build-tools\/tools\/deployments\/infisical-bootstrap\.ts repo --dry-run/);
    assert.match(
      text,
      /build-tools\/tools\/deployments\/infisical-bootstrap\.ts deployment --target <buck-target> --yes/,
    );
    assert.doesNotMatch(text, /use exactly one bootstrap mode/);
  }
});

test("bootstrap entrypoint is executable as documented", async () => {
  const mode = (await fs.stat("viberoots/build-tools/tools/deployments/infisical-bootstrap.ts"))
    .mode;
  assert.notEqual(mode & 0o111, 0);
});

test("bootstrap repo args default to generic resolver setup", () => {
  const args = parseBootstrapArgs(["repo"]);
  assert.equal(args.apiUrl, "https://app.infisical.com");
  assert.equal(args.cliDomain, "https://app.infisical.com/api");
  assert.equal(args.noTofuApply, false);
  assert.equal(args.tofuDir, "");
  assert.equal(args.withoutDeployments, false);
});

test("bootstrap repo args support deployment fan-out opt-out", () => {
  assert.equal(parseBootstrapArgs(["repo", "--without-deployments"]).withoutDeployments, true);
});

test("bootstrap deployment args default to reviewed OpenTofu setup", () => {
  const args = parseBootstrapArgs([
    "deployment",
    "--target",
    "//projects/deployments/pleomino/staging:deploy",
  ]);
  assert.equal(args.tofuDir, "projects/deployments/pleomino/infisical/opentofu");
});

test("bootstrap args support host shorthands and non-interactive controls", () => {
  const args = parseBootstrapArgs([
    "repo",
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
    "--machine-label",
    "ci-builder-1",
    "--apply-metadata-patch",
    "--yes",
  ]);
  assert.equal(args.apiUrl, "https://eu.infisical.com");
  assert.equal(args.cliDomain, "https://eu.infisical.com/api");
  assert.equal(args.accessTokenEnv, "TOKEN_ENV");
  assert.equal(args.organizationId, "org_1");
  assert.equal(args.noTofuApply, true);
  assert.equal(args.rotateDeploymentCredentials, true);
  assert.equal(args.machineLabel, "ci-builder-1");
  assert.equal(args.applyMetadataPatch, true);
  assert.equal(args.yes, true);
});

test("bootstrap args reject invalid machine labels", () => {
  assert.throws(
    () => parseBootstrapArgs(["repo", "--machine-label", "bad\nlabel"]),
    /--machine-label must be 1-80 characters/,
  );
});

test("--no-login requires an explicit organization selector", () => {
  assert.throws(
    () => parseBootstrapArgs(["repo", "--no-login", "--yes"]),
    /--no-login requires exactly one organization selector[\s\S]*--org-name <name> or --organization-id <id>/,
  );
  assert.equal(
    parseBootstrapArgs(["repo", "--no-login", "--org-name", "viberoots"]).orgName,
    "viberoots",
  );
  assert.equal(
    parseBootstrapArgs(["repo", "--no-login", "--organization-id", "org_1"]).organizationId,
    "org_1",
  );
});

test("bootstrap args parse explicit repo and deployment modes", () => {
  assert.equal(parseBootstrapArgs(["repo", "--dry-run"]).mode, "repo");
  const deployment = parseBootstrapArgs([
    "deployment",
    "--target",
    "//projects/deployments/pleomino/staging:deploy",
    "--dry-run",
  ]);
  assert.equal(deployment.mode, "deployment");
  assert.equal(deployment.target, "//projects/deployments/pleomino/staging:deploy");
});

test("bootstrap args reject ambiguous organization selectors", () => {
  assert.throws(
    () => parseBootstrapArgs(["repo", "--organization-id", "org_1", "--org-name", "viberoots"]),
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

test("login-based organization selection auto-selects one accessible org with --yes", async () => {
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
  let observedUpdateCheck = "";
  const commands: string[] = [];
  const captures: Array<boolean | undefined> = [];
  const runner: CommandRunner = ({ args, env, capture }) => {
    observedHome = String(env?.HOME || "");
    observedUpdateCheck = String(env?.INFISICAL_DISABLE_UPDATE_CHECK || "");
    commands.push(args.join(" "));
    captures.push(capture);
    if (args.includes("login")) return "";
    return "human-token\n";
  };
  const result = await getAccessToken({ ...DEFAULT_BOOTSTRAP_ARGS }, runner, {});
  assert.equal(result.token, "human-token");
  assert.match(observedHome, /infisical-iac-bootstrap-home-/);
  assert.equal(observedUpdateCheck, "true");
  assert.equal(commands[0], "vault set file --domain https://app.infisical.com/api --silent");
  assert.equal(captures[0], true);
  await assert.rejects(() => fs.stat(observedHome), /ENOENT/);
});

test("--no-login fails fast when the configured env var is missing", async () => {
  await assert.rejects(
    () => getAccessToken({ ...DEFAULT_BOOTSTRAP_ARGS, noLogin: true }, () => "", {}),
    /missing Infisical access token env var/,
  );
});

test("missing Infisical CLI reports install and token alternatives", () => {
  assert.throws(
    () =>
      spawnCommandRunner({
        command: "infisical",
        args: ["login"],
        env: { PATH: "" },
        capture: true,
      }),
    /Infisical CLI was not found[\s\S]*--infisical-bin[\s\S]*--no-login/,
  );
});

function fakeOrgApi(orgs: Array<{ id: string; name: string }>) {
  return { request: async () => ({ organizations: orgs }) };
}
