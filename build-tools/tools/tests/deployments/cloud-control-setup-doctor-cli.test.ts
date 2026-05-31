#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runCloudControlSetupCommand } from "../../deployments/cloud-control-setup";
import { withControlPlaneArgv } from "./control-plane-process-entrypoints.helpers";
import { privateLinkAwsTopology, topologyForPublishedImage } from "./cloud-control-cutover-fixture";
import { reviewedRuntimeInputYaml } from "./cloud-control-runtime-input.fixture";
import { privateLinkSupabaseProfile } from "./control-plane-supabase-postgres.fixture";
import { setupArgPairs } from "./cloud-control-setup-doctor.helpers";

const DIGEST = `sha256:${"c".repeat(64)}`;
const DIGEST_REF = `registry.example.com/platform/deployment-control-plane@${DIGEST}`;
const BUILD_IDENTITY = `nix-source-${"d".repeat(64)}`;

test("dry-run next commands include full setup flags and runbook outputs", async () => {
  const previousExitCode = process.exitCode;
  const output: string[] = [];
  const previousLog = console.log;
  console.log = (message?: unknown) => output.push(String(message));
  process.exitCode = undefined;
  try {
    const topologyFile = path.join("buck-out/tmp", "cloud-control-setup-doctor-topology.json");
    const supabaseFile = path.join("buck-out/tmp", "cloud-control-setup-doctor-supabase.json");
    const runtimeFile = path.join("buck-out/tmp", "cloud-control-setup-doctor-runtime.yaml");
    await fsp.mkdir(path.dirname(topologyFile), { recursive: true });
    await fsp.writeFile(topologyFile, JSON.stringify(topologyForImage()), "utf8");
    await fsp.writeFile(supabaseFile, JSON.stringify(privateLinkSupabaseProfile()), "utf8");
    await fsp.writeFile(runtimeFile, reviewedRuntimeInputYaml(), "utf8");
    const args = [
      "setup",
      "--dry-run",
      ...setupArgPairs(DIGEST_REF, BUILD_IDENTITY, DIGEST).flat(),
      "--aws-topology-evidence",
      topologyFile,
      "--supabase-postgres-profile",
      supabaseFile,
      "--runtime-input",
      runtimeFile,
    ];
    await withControlPlaneArgv(args, runCloudControlSetupCommand);
    const result = JSON.parse(output.join("\n"));
    const commands = result.nextCommands.join("\n");
    assert.equal(result.ok, true);
    for (const flag of [
      "--image-publication-evidence",
      "--public-url",
      "--auth-callback-host",
      "--deployment-id",
      "--artifact-backend",
      "--reviewed-source-mode",
      "--aws-topology-evidence",
      "--supabase-postgres-profile",
      "--runtime-input",
    ]) {
      assert.ok(commands.includes(flag), `missing ${flag}`);
    }
    assert.doesNotMatch(commands, /provide --expected-image-build-identity/);
    assert.match(
      commands,
      /setup-doctor[\s\S]*--out \.\/cloud-control-profile\/setup-doctor\.json/,
    );
  } finally {
    console.log = previousLog;
    process.exitCode = previousExitCode;
  }
});

function topologyForImage() {
  return topologyForPublishedImage(privateLinkAwsTopology(), DIGEST_REF, DIGEST);
}
