#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { shouldPrepareVerifySeedForRequestedTargets } from "../../dev/verify/seed";
import { assertVerifySeedComplete, verifySeedBuildArgs } from "../../dev/verify/seed-build";
import { seedProtocolIdentity } from "../../dev/verify/seed-key-protocol";
import { writeVerifySeedRemoteManifest } from "../../dev/verify/seed-manifest";
import { readCurrentSeed, writeCurrentSeed } from "../../dev/verify/seed-pins";
import { mktemp } from "../lib/test-helpers";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

async function readRepoFile(relativePath: string): Promise<string> {
  return await fsp.readFile(viberootsSourcePath(relativePath), "utf8");
}

test("verify seed build policy defaults to full-suite only", () => {
  assert.equal(shouldPrepareVerifySeedForRequestedTargets([], {}), false);
  assert.equal(shouldPrepareVerifySeedForRequestedTargets(["//..."], {}), true);
  assert.equal(
    shouldPrepareVerifySeedForRequestedTargets(["//projects/apps/my-app/..."], {}),
    false,
  );
  assert.equal(
    shouldPrepareVerifySeedForRequestedTargets(["//projects/...", "//viberoots/..."], {}),
    true,
  );
  assert.equal(
    shouldPrepareVerifySeedForRequestedTargets(["@viberoots//build-tools/tools/tests/..."], {}),
    true,
  );
});

test("verify seed policy honors override mode", () => {
  assert.equal(
    shouldPrepareVerifySeedForRequestedTargets(["//projects/apps/my-app/..."], {
      VBR_VERIFY_SEED_MODE: "always",
    }),
    true,
  );
  assert.equal(
    shouldPrepareVerifySeedForRequestedTargets(["//..."], { VBR_VERIFY_SEED_MODE: "never" }),
    false,
  );
});

test("verify seed build args split local pinning from remote-ready no-link mode", () => {
  const flakeRef =
    "path:/nix/store/00000000000000000000000000000000-viberoots-evaluation-bundle?dir=source#test-seed";
  assert.deepEqual(
    verifySeedBuildArgs({
      flakeRef,
      mode: "local",
      gcRootPath: "/repo/.viberoots/workspace/buck/verify-seed/nix-root",
    }).slice(-3),
    ["--out-link", "/repo/.viberoots/workspace/buck/verify-seed/nix-root", "--print-out-paths"],
  );
  const remoteArgs = verifySeedBuildArgs({
    flakeRef,
    mode: "remote-ready",
  });
  assert.ok(remoteArgs.includes("--no-link"));
  assert.ok(remoteArgs.includes("--print-out-paths"));
  assert.ok(!remoteArgs.includes("--out-link"));
  assert.ok(remoteArgs.includes("--no-write-lock-file"));
});

test("verify seed build args require the caller's immutable bundle authority", () => {
  const flakeRef =
    "path:/nix/store/00000000000000000000000000000000-viberoots-evaluation-bundle?dir=source/.viberoots/workspace#test-seed";
  const args = verifySeedBuildArgs({ flakeRef, mode: "remote-ready" });
  assert.ok(args.includes(flakeRef));
  assert.equal(args.includes("--impure"), true);
  assert.throws(
    () =>
      verifySeedBuildArgs({
        flakeRef: "path:/repo/.viberoots/workspace#test-seed",
        mode: "remote-ready",
      }),
    /canonical immutable evaluation-bundle source/,
  );
});

test("verify seed build args pin reviewed cache substituters explicitly", () => {
  const flakeRef =
    "path:/nix/store/00000000000000000000000000000000-viberoots-evaluation-bundle?dir=source#test-seed";
  const args = verifySeedBuildArgs({
    flakeRef,
    mode: "remote-ready",
    nixConfig: [
      "substituters = https://cache.nixos.org/",
      "extra-substituters = https://install.determinate.systems",
    ].join("\n"),
  });
  const optionValue = (name: string) => {
    const index = args.findIndex(
      (arg, argIndex) => arg === name && args[argIndex - 1] === "--option",
    );
    assert.ok(index >= 0, `missing --option ${name}`);
    return args[index + 1];
  };
  assert.equal(optionValue("substituters"), "https://cache.nixos.org/");
  assert.equal(optionValue("extra-substituters"), "https://install.determinate.systems");
  assert.equal(optionValue("fallback"), "true");
});

test("verify seed completeness accepts root and generated workspace flake layouts", async () => {
  const rootFlake = await mktemp("verify-seed-root-flake-");
  const workspaceFlake = await mktemp("verify-seed-workspace-flake-");
  const incomplete = await mktemp("verify-seed-incomplete-");
  try {
    for (const seed of [rootFlake, workspaceFlake, incomplete]) {
      await fsp.writeFile(path.join(seed, ".buckconfig"), "", "utf8");
      await fsp.mkdir(path.join(seed, "viberoots"), { recursive: true });
      await fsp.writeFile(path.join(seed, "viberoots", "flake.nix"), "{}\n", "utf8");
    }
    await fsp.writeFile(path.join(rootFlake, "flake.nix"), "{}\n", "utf8");
    await fsp.mkdir(path.join(workspaceFlake, ".viberoots", "workspace"), { recursive: true });
    await fsp.writeFile(
      path.join(workspaceFlake, ".viberoots", "workspace", "flake.nix"),
      "{}\n",
      "utf8",
    );

    await assert.doesNotReject(assertVerifySeedComplete(rootFlake));
    await assert.doesNotReject(assertVerifySeedComplete(workspaceFlake));
    await assert.rejects(assertVerifySeedComplete(incomplete), /missing flake\.nix or/);
  } finally {
    await Promise.all(
      [rootFlake, workspaceFlake, incomplete].map((seed) =>
        fsp.rm(seed, { recursive: true, force: true }),
      ),
    );
  }
});

test("verify seed reuses matching current seed before building", async () => {
  const source = await readRepoFile("build-tools/tools/dev/verify/seed.ts");
  const currentLookup = source.indexOf("await readCurrentSeed(opts.root, seedKey)");
  const buildCall = source.indexOf(
    "await buildSeedStorePath(opts.root, opts.artifactToolsRoot, opts.cacheHealth, mode)",
  );
  assert.ok(currentLookup > 0, "prepareVerifySeed must read current seed state");
  assert.ok(buildCall > currentLookup, "prepareVerifySeed must try current seed before nix build");
  assert.match(source, /\.viberoots", "workspace", "buck", "verify-seed"/);
  assert.doesNotMatch(source, /"buck-out", "tmp", "verify-seed"/);
});

test("verify seed key includes active viberoots submodule state", async () => {
  const source = await readRepoFile("build-tools/tools/dev/verify/seed.ts");
  assert.match(source, /const viberootsRoot = path\.join\(root, "viberoots"\)/);
  assert.match(source, /computeGitState\(viberootsRoot\)/);
  assert.match(source, /viberootsGit/);
});

test("verify seed protocol changes invalidate the current seed", async () => {
  const root = await mktemp("verify-seed-protocol-");
  const seedPath = path.join(root, "seed");
  try {
    await fsp.mkdir(seedPath, { recursive: true });
    const oldKey = JSON.stringify(seedProtocolIdentity(".seed-store-prepared-v8", "stage-v9"));
    const newKey = JSON.stringify(seedProtocolIdentity(".seed-store-prepared-v9", "stage-v10"));
    assert.notEqual(newKey, oldKey);
    await writeCurrentSeed(root, seedPath, oldKey);
    assert.equal(await readCurrentSeed(root, oldKey), seedPath);
    assert.equal(await readCurrentSeed(root, newKey), null);
    const seedSource = await readRepoFile("build-tools/tools/dev/verify/seed.ts");
    assert.match(seedSource, /seedProtocol: seedProtocolIdentity\(\)/);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("verify seed disables detached Git maintenance before writing objects", async () => {
  const source = await readRepoFile("build-tools/tools/nix/flake/packages/test-seed.nix");
  for (const repo of ['"$out/viberoots"', '"$out"']) {
    const config = source.indexOf(`git -C ${repo} config maintenance.auto false`);
    const detach = source.indexOf(`git -C ${repo} config gc.autoDetach false`);
    const add = source.indexOf(`git -C ${repo} add -A`);
    assert.ok(config > 0 && config < add, `${repo} must disable maintenance before git add`);
    assert.ok(detach > 0 && detach < add, `${repo} must disable detached gc before git add`);
  }
});

test("verify seed remote-ready manifest records explicit cache artifact path", async () => {
  const root = await mktemp("verify-seed-manifest-root-");
  const manifest = await writeVerifySeedRemoteManifest({
    root,
    seedPath: "/nix/store/example-test-seed",
  });
  const parsed = JSON.parse(await fsp.readFile(manifest, "utf8"));
  assert.equal(parsed.kind, "verify-seed-remote-ready");
  assert.equal(parsed.seedPath, "/nix/store/example-test-seed");
  assert.equal(parsed.cacheManifest.storePath, "/nix/store/example-test-seed");
});
