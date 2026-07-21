import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  buildArgs,
  nixEnv,
  repoRoot,
  stageFixtureLock,
  writeFixture,
} from "./pnpm-fixed-store-native-fixture";
import { directorySizeKib, runGuardedCommand } from "./pnpm-fixed-store-native-run";
import {
  immutableProductionSource,
  mismatchCandidate,
  strictGot,
} from "./pnpm-fixed-store-native-source";

const MAX_KIB = 500 * 1024;
const TEST_TIMEOUT_MS = 18 * 60 * 1000;

test(
  "native fixed pnpm reconciliation is deterministic and offline-consumable",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-native-pnpm-reconcile-"));
    const nix = "/nix/var/nix/profiles/default/bin/nix";
    try {
      const flakeLock = JSON.parse(await fsp.readFile(path.join(repoRoot(), "flake.lock"), "utf8"));
      const nixpkgsNode = flakeLock.nodes.root.inputs.nixpkgs;
      const locked = flakeLock.nodes[nixpkgsNode].locked;
      const lockedRef = `github:${locked.owner}/${locked.repo}/${locked.rev}`;
      const setupHome = path.join(root, "setup-home");
      await fsp.mkdir(setupHome, { recursive: true });
      const archive = await runGuardedCommand(nix, ["flake", "archive", "--json", lockedRef], {
        cwd: root,
        env: nixEnv(setupHome),
        fixtureRoot: root,
      });
      assert.equal(archive.status, 0, archive.stderr);
      const nixpkgsPath = JSON.parse(archive.stdout).path;
      assert.match(nixpkgsPath, /^\/nix\/store\/[a-z0-9]+-source$/);
      const viberootsPath = await immutableProductionSource(repoRoot());

      const fixtures = [path.join(root, "candidate-a"), path.join(root, "candidate-b")];
      await Promise.all(
        fixtures.map((fixture) => writeFixture(fixture, nixpkgsPath, viberootsPath)),
      );
      for (const fixture of fixtures) {
        const locked = await runGuardedCommand(nix, ["flake", "lock"], {
          cwd: fixture,
          env: nixEnv(path.join(root, "lock-home")),
          fixtureRoot: root,
        });
        assert.equal(locked.status, 0, locked.stderr);
        await stageFixtureLock(fixture);
      }
      const candidates: string[] = [];
      for (const [index, fixture] of fixtures.entries()) {
        const home = path.join(root, `home-${index}`);
        await fsp.mkdir(home, { recursive: true });
        const result = await runGuardedCommand(nix, buildArgs(), {
          cwd: fixture,
          env: nixEnv(home),
          fixtureRoot: root,
        });
        assert.notEqual(result.status, 0, "placeholder FOD build must report a mismatch");
        await assert.rejects(fsp.access(mismatchCandidate(result.stderr)), { code: "ENOENT" });
        candidates.push(strictGot(result.stderr));
      }
      assert.equal(candidates[0], candidates[1]);

      await fsp.writeFile(
        path.join(fixtures[0], "build-tools", "tools", "nix", "node-modules.hashes.json"),
        JSON.stringify({ "pnpm-lock.yaml": candidates[0] }) + "\n",
      );
      const final = await runGuardedCommand(nix, buildArgs(true), {
        cwd: fixtures[0],
        env: nixEnv(path.join(root, "home-0")),
        fixtureRoot: root,
      });
      assert.equal(final.status, 0, final.stderr);
      const outPath = final.stdout.trim().split(/\s+/).at(-1) || "";
      assert.match(outPath, /^\/nix\/store\/[a-z0-9]+-pnpm-store-lock-[a-f0-9]{64}$/);

      const pinnedPnpm = await runGuardedCommand(
        nix,
        ["eval", "--impure", "--no-write-lock-file", "--raw", ".#pinnedPnpm.outPath"],
        { cwd: fixtures[0], env: nixEnv(path.join(root, "home-0")), fixtureRoot: root },
      );
      assert.equal(pinnedPnpm.status, 0, pinnedPnpm.stderr);

      const consume = path.join(root, "consume");
      await fsp.mkdir(consume, { recursive: true });
      await Promise.all([
        fsp.copyFile(path.join(fixtures[0], "package.json"), path.join(consume, "package.json")),
        fsp.copyFile(
          path.join(fixtures[0], "pnpm-lock.yaml"),
          path.join(consume, "pnpm-lock.yaml"),
        ),
        fsp.cp(path.join(outPath, "store"), path.join(consume, "store"), { recursive: true }),
      ]);
      const offline = await runGuardedCommand(
        "bash",
        [
          "--noprofile",
          "--norc",
          "-c",
          `chmod -R u+rwX store && ${JSON.stringify(path.join(pinnedPnpm.stdout.trim(), "bin/pnpm"))} install --offline --force --frozen-lockfile --ignore-scripts --ignore-pnpmfile --prod=false --store-dir "$PWD/store" --modules-dir node_modules --virtual-store-dir node_modules/.pnpm --package-import-method copy --reporter=append-only --color never && node -e 'process.stdout.write(require.resolve("never"))'`,
        ],
        {
          cwd: consume,
          env: {
            ...nixEnv(path.join(root, "consume-home")),
            CI: "1",
            NO_COLOR: "1",
            FORCE_COLOR: "0",
          },
          fixtureRoot: root,
        },
      );
      assert.equal(offline.status, 0, offline.stderr);
      const ansiCsi = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, "g");
      const offlineOutput = offline.stdout.replace(ansiCsi, "");
      assert.match(offlineOutput, /downloaded\s+0/);
      assert.match(offlineOutput, /node_modules.*never.*index\.js/);

      const deleted = await runGuardedCommand(nix, ["store", "delete", outPath], {
        cwd: root,
        env: nixEnv(path.join(root, "delete-home")),
        fixtureRoot: root,
      });
      assert.equal(deleted.status, 0, deleted.stderr);
      await fsp.writeFile(
        path.join(fixtures[1], "build-tools", "tools", "nix", "node-modules.hashes.json"),
        JSON.stringify({ "pnpm-lock.yaml": candidates[0] }) + "\n",
      );
      const hashMetadata = await fsp.readFile(
        path.join(fixtures[1], "build-tools", "tools", "nix", "node-modules.hashes.json"),
      );
      const updater = await runGuardedCommand(
        process.execPath,
        [
          "--experimental-strip-types",
          "--import",
          path.join(repoRoot(), "build-tools", "tools", "dev", "zx-init.mjs"),
          path.join(repoRoot(), "build-tools", "tools", "dev", "update-pnpm-hash.ts"),
          "--lockfile",
          "pnpm-lock.yaml",
        ],
        {
          cwd: fixtures[1],
          env: {
            ...nixEnv(path.join(root, "reconcile-home"), "reconcile"),
            VIBEROOTS_FLAKE_INPUT_ROOT: viberootsPath,
          },
          fixtureRoot: root,
          diskRoot: "/nix",
        },
      );
      assert.equal(updater.status, 0, updater.stderr);
      assert.match(updater.stdout, /hash updated and build succeeded/);
      const archived = await runGuardedCommand(nix, ["flake", "archive", "--json", "."], {
        cwd: fixtures[1],
        env: nixEnv(path.join(root, "archive-home"), "materialize"),
        fixtureRoot: root,
      });
      assert.equal(archived.status, 0, archived.stderr);
      const archivedSource = String(JSON.parse(archived.stdout).path || "");
      assert.match(archivedSource, /^\/nix\/store\/[a-z0-9]{32}-source$/);
      for (const generatedRoot of [".nix-gcroots", ".viberoots", "buck-out"]) {
        await assert.rejects(fsp.access(path.join(archivedSource, generatedRoot)), {
          code: "ENOENT",
        });
      }
      const rematerialized = await runGuardedCommand(nix, buildArgs(true), {
        cwd: fixtures[1],
        env: nixEnv(path.join(root, "verify-home")),
        fixtureRoot: root,
      });
      assert.equal(rematerialized.status, 0, rematerialized.stderr);
      assert.equal(rematerialized.stdout.trim().split(/\s+/).at(-1), outPath);
      assert.deepEqual(
        await fsp.readFile(
          path.join(fixtures[1], "build-tools", "tools", "nix", "node-modules.hashes.json"),
        ),
        hashMetadata,
      );
      const marker = JSON.parse(
        await fsp.readFile(
          path.join(
            fixtures[1],
            ".viberoots",
            "workspace",
            "buck",
            "tmp",
            "pnpm-store-verified.root.json",
          ),
          "utf8",
        ),
      );
      assert.equal(marker.hashValue, candidates[0]);
      assert.ok((await directorySizeKib(root)) < MAX_KIB);
    } finally {
      await fsp.rm(root, { recursive: true, force: true });
    }
  },
);
