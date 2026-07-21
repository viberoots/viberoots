import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { materializeFilteredViberootsSource } from "../../dev/filtered-flake-viberoots-input";
import { withPnpmStoreBuildFlakeRef } from "../../dev/update-pnpm-hash/build-flake";
import { selectedUpdateViberootsInput } from "../../dev/update-pnpm-hash/filtered-flake";
import { pnpmNixRunArgs } from "../../dev/update-pnpm-hash/importer-lockfile";
import { activeViberootsOverride, nixBuildArgs } from "../../dev/update-pnpm-hash/nix";
import {
  finalPnpmStoreDerivationEvalArgs,
  finalPnpmStoreEvalArgs,
} from "../../dev/update-pnpm-hash/realized-store";
async function source(root: string, name: string): Promise<string> {
  const dir = path.join(root, name);
  await fsp.mkdir(path.join(dir, "build-tools/tools/dev"), { recursive: true });
  await fsp.mkdir(path.join(dir, ".viberoots/workspace"), { recursive: true });
  await fsp.writeFile(path.join(dir, "package.json"), '{"name":"viberoots"}\n');
  await fsp.writeFile(path.join(dir, "flake.nix"), "{ outputs = _: {}; }\n");
  await fsp.writeFile(path.join(dir, "build-tools/tools/dev/zx-init.mjs"), "\n");
  await fsp.writeFile(path.join(dir, "build-tools/tools/dev/viberoots.ts"), "\n");
  await fsp.copyFile(
    path.join(process.cwd(), ".viberoots/workspace/toolchain-paths.json"),
    path.join(dir, ".viberoots/workspace/toolchain-paths.json"),
  );
  return dir;
}

test("explicit flake-input authority wins over live current", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-input-authority-"));
  try {
    const current = await source(root, ".viberoots/current");
    const immutable = (
      await materializeFilteredViberootsSource(await source(root, "immutable-input"), process.env)
    ).storePath;
    assert.match(immutable, /^\/nix\/store\/[a-z0-9]{32}-source$/);
    const flake = path.join(root, "filtered");
    await fsp.mkdir(flake);
    const flakeRef = `path:${flake}`;
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      WORKSPACE_ROOT: root,
      VBR_PNPM_FILTERED_SNAPSHOT_ROOT: root,
      VIBEROOTS_FLAKE_INPUT_ROOT: immutable,
    };
    const override = ["--override-input", "viberoots", `path:${immutable}`];
    assert.deepEqual(activeViberootsOverride(`${flakeRef}#probe`, env), override);
    assert.deepEqual(pnpmNixRunArgs(flakeRef, ["fetch"], env), [
      "--quiet",
      "run",
      "--accept-flake-config",
      "--no-write-lock-file",
      ...override,
      flakeRef,
      "--",
      "fetch",
    ]);
    assert.deepEqual(finalPnpmStoreEvalArgs(env, flakeRef, "pnpm-store.fixture"), [
      "eval",
      "--impure",
      ...override,
      "--raw",
      "--no-write-lock-file",
      "--accept-flake-config",
      `${flakeRef}#pnpm-store.fixture.outPath`,
    ]);
    assert.deepEqual(finalPnpmStoreDerivationEvalArgs(env, flakeRef, "pnpm-store.fixture"), [
      "eval",
      "--impure",
      ...override,
      "--raw",
      "--no-write-lock-file",
      "--accept-flake-config",
      `${flakeRef}#pnpm-store.fixture.drvPath`,
    ]);
    const previousProcessAuthority = process.env.VIBEROOTS_FLAKE_INPUT_ROOT;
    process.env.VIBEROOTS_FLAKE_INPUT_ROOT = current;
    try {
      const buildArgs = nixBuildArgs({
        flakeRef,
        attrPath: "pnpm-store.fixture",
        printOutPaths: true,
        maxJobs: "0",
        cores: "0",
        extraEnv: env,
      });
      const overrideIndex = buildArgs.indexOf("--override-input");
      assert.deepEqual(buildArgs.slice(overrideIndex, overrideIndex + 3), override);
      assert.ok(!buildArgs.includes(`path:${current}`));
    } finally {
      if (previousProcessAuthority === undefined) delete process.env.VIBEROOTS_FLAKE_INPUT_ROOT;
      else process.env.VIBEROOTS_FLAKE_INPUT_ROOT = previousProcessAuthority;
    }
    delete env.VIBEROOTS_FLAKE_INPUT_ROOT;
    await fsp.realpath(current);
    assert.throws(
      () => activeViberootsOverride(`${flakeRef}#probe`, env),
      /requires an immutable Nix-store viberoots flake-input authority/,
    );
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("update source selection preserves active dirty sources and ignores inactive copies", () => {
  const immutable = "/nix/store/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-source";
  const gitlink = `160000 ${"b".repeat(40)} 0\tviberoots\n`;
  assert.equal(
    selectedUpdateViberootsInput({
      standalone: true,
      gitlinkEntry: "",
      immutableInputRoot: immutable,
    }),
    "",
  );
  assert.equal(
    selectedUpdateViberootsInput({
      standalone: false,
      gitlinkEntry: gitlink,
      immutableInputRoot: immutable,
    }),
    "",
  );
  assert.equal(
    selectedUpdateViberootsInput({
      standalone: false,
      gitlinkEntry: "",
      immutableInputRoot: immutable,
    }),
    immutable,
  );
  assert.equal(
    selectedUpdateViberootsInput({
      standalone: false,
      gitlinkEntry: gitlink,
      immutableInputRoot: immutable,
    }),
    "",
  );
  assert.throws(
    () =>
      selectedUpdateViberootsInput({
        standalone: false,
        gitlinkEntry: "",
        immutableInputRoot: "",
      }),
    /requires an immutable viberoots flake-input authority/,
  );
});

test("bundle dir refs use the immutable authority in their own lock", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-bundle-authority-"));
  try {
    const materialized = await materializeFilteredViberootsSource(
      await source(root, "immutable-input"),
      process.env,
    );
    const flakeDir = path.join(root, "source", "consumer");
    await fsp.mkdir(flakeDir, { recursive: true });
    await fsp.writeFile(
      path.join(flakeDir, "flake.nix"),
      `inputs.viberoots.url = "path:${materialized.storePath}";\n`,
    );
    await fsp.writeFile(
      path.join(flakeDir, "flake.lock"),
      `${JSON.stringify(
        {
          nodes: {
            root: { inputs: { viberoots: "viberoots" } },
            viberoots: {
              locked: materialized.locked,
              original: { type: "path", path: materialized.storePath },
            },
          },
        },
        null,
        2,
      )}\n`,
    );
    assert.deepEqual(activeViberootsOverride(`path:${root}?dir=source/consumer#probe`, {}), []);
    assert.throws(
      () => activeViberootsOverride(`path:${root}?dir=../consumer#probe`, {}),
      /requires an immutable Nix-store/,
    );
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("standalone u reconciliation gives every Nix argv an immutable viberoots authority", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-standalone-authority-"));
  const standalone = await source(root, "standalone");
  const previousAuthority = process.env.VIBEROOTS_FLAKE_INPUT_ROOT;
  try {
    delete process.env.VIBEROOTS_FLAKE_INPUT_ROOT;
    await withPnpmStoreBuildFlakeRef(
      { repoRoot: standalone, importer: ".", baseFlakeRef: `path:${standalone}` },
      async (flakeRef, filteredEnv = {}) => {
        const authority = String(filteredEnv.VIBEROOTS_FLAKE_INPUT_ROOT || "");
        assert.match(authority, /^\/nix\/store\/[a-z0-9]{32}-source$/);
        assert.notEqual(authority, filteredEnv.WORKSPACE_ROOT);
        const override = ["--override-input", "viberoots", `path:${authority}`];
        const argv = [
          nixBuildArgs({
            flakeRef,
            attrPath: "pnpm-store.default",
            printOutPaths: true,
            maxJobs: "0",
            cores: "0",
            extraEnv: filteredEnv,
          }),
          pnpmNixRunArgs(flakeRef, ["fetch"], filteredEnv),
          finalPnpmStoreEvalArgs(filteredEnv, flakeRef, "pnpm-store.default"),
          finalPnpmStoreDerivationEvalArgs(filteredEnv, flakeRef, "pnpm-store.default"),
        ];
        for (const args of argv) {
          const index = args.indexOf("--override-input");
          assert.deepEqual(args.slice(index, index + 3), override);
          assert.ok(!args.some((arg) => arg === `path:${standalone}`));
        }
      },
    );
  } finally {
    if (previousAuthority === undefined) delete process.env.VIBEROOTS_FLAKE_INPUT_ROOT;
    else process.env.VIBEROOTS_FLAKE_INPUT_ROOT = previousAuthority;
    await fsp.rm(root, { recursive: true, force: true });
  }
});
