import assert from "node:assert/strict";
import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  assertNativePnpmArchiveRoundTrip,
  assertOfflineNativePnpmConsumption,
  timedNativePnpmPhase as timed,
} from "./pnpm-fixed-store-native-consumption";
import {
  buildArgs,
  nixEnv,
  repoRoot,
  stageFixtureLock,
  writeFixture,
} from "./pnpm-fixed-store-native-fixture";
import { directorySizeKib, runGuardedCommand } from "./pnpm-fixed-store-native-run";
import {
  snapshotExactOwnedPnpmPaths,
  verifyNativePnpmOwnedEvidence,
} from "./pnpm-fixed-store-owned-evidence";
import {
  immutableProductionSource,
  mismatchCandidate,
  strictGot,
} from "./pnpm-fixed-store-native-source";

const MAX_KIB = 500 * 1024;
const TEST_TIMEOUT_MS =
  Number(process.env.TEST_NIX_TIMEOUT_SECS || process.env.VERIFY_TIMEOUT_SECS || "2400") * 1000;

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
      const archive = await timed(
        "nixpkgs archive",
        async () =>
          await runGuardedCommand(nix, ["flake", "archive", "--json", lockedRef], {
            cwd: root,
            env: nixEnv(setupHome),
            fixtureRoot: root,
          }),
      );
      assert.equal(archive.status, 0, archive.stderr);
      const nixpkgsPath = JSON.parse(archive.stdout).path;
      assert.match(nixpkgsPath, /^\/nix\/store\/[a-z0-9]+-source$/);
      const viberootsPath = await timed(
        "immutable viberoots source",
        async () => await immutableProductionSource(repoRoot()),
      );

      const fixtures = [path.join(root, "candidate-a"), path.join(root, "candidate-b")];
      await timed(
        "fixture preparation",
        async () =>
          await Promise.all(
            fixtures.map((fixture) => writeFixture(fixture, nixpkgsPath, viberootsPath)),
          ),
      );
      await timed("fixture flake locks", async () => {
        for (const fixture of fixtures) {
          const locked = await runGuardedCommand(nix, ["flake", "lock"], {
            cwd: fixture,
            env: nixEnv(path.join(root, "lock-home")),
            fixtureRoot: root,
          });
          assert.equal(locked.status, 0, locked.stderr);
          await stageFixtureLock(fixture);
        }
      });
      const candidates: string[] = [];
      for (const [index, fixture] of fixtures.entries()) {
        const home = path.join(root, `home-${index}`);
        await fsp.mkdir(home, { recursive: true });
        const result = await timed(
          `placeholder build ${index + 1}`,
          async () =>
            await runGuardedCommand(nix, buildArgs(), {
              cwd: fixture,
              env: nixEnv(home),
              fixtureRoot: root,
            }),
        );
        assert.notEqual(result.status, 0, "placeholder FOD build must report a mismatch");
        await assert.rejects(fsp.access(mismatchCandidate(result.stderr)), { code: "ENOENT" });
        candidates.push(strictGot(result.stderr));
      }
      assert.equal(candidates[0], candidates[1]);

      await fsp.writeFile(
        path.join(fixtures[0], "build-tools", "tools", "nix", "node-modules.hashes.json"),
        JSON.stringify({ "pnpm-lock.yaml": candidates[0] }) + "\n",
      );
      const final = await timed(
        "fixed-output build",
        async () =>
          await runGuardedCommand(nix, buildArgs(true), {
            cwd: fixtures[0],
            env: nixEnv(path.join(root, "home-0")),
            fixtureRoot: root,
          }),
      );
      assert.equal(final.status, 0, final.stderr);
      const outPath = final.stdout.trim().split(/\s+/).at(-1) || "";
      assert.match(outPath, /^\/nix\/store\/[a-z0-9]+-pnpm-store-lock-[a-f0-9]{64}$/);

      const pinnedPnpm = await timed(
        "pinned pnpm evaluation",
        async () =>
          await runGuardedCommand(
            nix,
            ["eval", "--impure", "--no-write-lock-file", "--raw", ".#pinnedPnpm.outPath"],
            { cwd: fixtures[0], env: nixEnv(path.join(root, "home-0")), fixtureRoot: root },
          ),
      );
      assert.equal(pinnedPnpm.status, 0, pinnedPnpm.stderr);

      await assertOfflineNativePnpmConsumption({
        fixture: fixtures[0],
        outPath,
        pinnedPnpmPath: pinnedPnpm.stdout.trim(),
        root,
      });

      const deleted = await timed(
        "fixed-output deletion",
        async () =>
          await runGuardedCommand(nix, ["store", "delete", outPath], {
            cwd: root,
            env: nixEnv(path.join(root, "delete-home")),
            fixtureRoot: root,
          }),
      );
      assert.equal(deleted.status, 0, deleted.stderr);
      await fsp.writeFile(
        path.join(fixtures[1], "build-tools", "tools", "nix", "node-modules.hashes.json"),
        JSON.stringify({ "pnpm-lock.yaml": candidates[0] }) + "\n",
      );
      const hashMetadata = await fsp.readFile(
        path.join(fixtures[1], "build-tools", "tools", "nix", "node-modules.hashes.json"),
      );
      const lockHashHex = crypto
        .createHash("sha256")
        .update(await fsp.readFile(path.join(fixtures[1], "pnpm-lock.yaml")))
        .digest("hex");
      const beforeOwnedPaths = await snapshotExactOwnedPnpmPaths(lockHashHex);
      const registrationStartedAt = Math.floor(Date.now() / 1000);
      const updater = await timed(
        "update-pnpm-hash reconciliation",
        async () =>
          await runGuardedCommand(
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
            },
          ),
      );
      assert.equal(updater.status, 0, updater.stderr);
      assert.match(updater.stdout, /hash updated and build succeeded/);
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
      assert.match(marker.derivationIdentity, /^\/nix\/store\/[a-z0-9]{32}-[^/]+\.drv$/);
      const markerOutput = await timed(
        "marker output query",
        async () =>
          await runGuardedCommand(
            path.join(path.dirname(nix), "nix-store"),
            ["--query", "--outputs", marker.derivationIdentity],
            {
              cwd: fixtures[1],
              env: nixEnv(path.join(root, "marker-home"), "materialize"),
              fixtureRoot: root,
            },
          ),
      );
      assert.equal(markerOutput.status, 0, markerOutput.stderr);
      const markerOutPath = markerOutput.stdout.trim();
      assert.match(markerOutPath, /^\/nix\/store\/[a-z0-9]+-pnpm-store-lock-[a-f0-9]{64}$/);
      assert.equal(path.basename(markerOutPath).endsWith(lockHashHex), true);
      await timed(
        "owned evidence verification",
        async () =>
          await verifyNativePnpmOwnedEvidence({
            beforeOwnedPaths,
            cwd: fixtures[1],
            env: nixEnv(path.join(root, "owned-evidence-home"), "materialize"),
            fixtureRoot: root,
            lockHash: lockHashHex,
            markerDerivation: marker.derivationIdentity,
            markerOutput: markerOutPath,
            maxKib: MAX_KIB,
            nix,
            peakFixtureKib: updater.peakFixtureKib,
            registrationStartedAt,
            sourceAuthority: viberootsPath,
          }),
      );
      await assertNativePnpmArchiveRoundTrip({
        fixture: fixtures[1],
        hashMetadata,
        markerOutPath,
        nix,
        outPath,
        root,
      });
      assert.ok((await directorySizeKib(root)) < MAX_KIB);
    } finally {
      await fsp.rm(root, { recursive: true, force: true });
    }
  },
);
