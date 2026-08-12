import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { buildArgs, nixEnv } from "./pnpm-fixed-store-native-fixture";
import { runGuardedCommand } from "./pnpm-fixed-store-native-run";

export async function timedNativePnpmPhase<T>(
  label: string,
  operation: () => Promise<T>,
): Promise<T> {
  const started = performance.now();
  try {
    return await operation();
  } finally {
    console.log(
      `[timing] pnpm native reconciliation ${label}: ${(performance.now() - started).toFixed(1)}ms`,
    );
  }
}

export async function assertOfflineNativePnpmConsumption(options: {
  fixture: string;
  outPath: string;
  pinnedPnpmPath: string;
  root: string;
}): Promise<void> {
  const consume = path.join(options.root, "consume");
  await fsp.mkdir(consume, { recursive: true });
  await Promise.all([
    fsp.copyFile(path.join(options.fixture, "package.json"), path.join(consume, "package.json")),
    fsp.copyFile(
      path.join(options.fixture, "pnpm-lock.yaml"),
      path.join(consume, "pnpm-lock.yaml"),
    ),
    fsp.cp(path.join(options.outPath, "store"), path.join(consume, "store"), { recursive: true }),
  ]);
  const offline = await timedNativePnpmPhase(
    "offline consumption",
    async () =>
      await runGuardedCommand(
        "bash",
        [
          "--noprofile",
          "--norc",
          "-c",
          `chmod -R u+rwX store && ${JSON.stringify(path.join(options.pinnedPnpmPath, "bin/pnpm"))} install --offline --force --frozen-lockfile --ignore-scripts --ignore-pnpmfile --prod=false --store-dir "$PWD/store" --modules-dir node_modules --virtual-store-dir node_modules/.pnpm --package-import-method copy --reporter=append-only --color never && node -e 'process.stdout.write(require.resolve("never"))'`,
        ],
        {
          cwd: consume,
          env: {
            ...nixEnv(path.join(options.root, "consume-home")),
            CI: "1",
            NO_COLOR: "1",
            FORCE_COLOR: "0",
          },
          fixtureRoot: options.root,
        },
      ),
  );
  assert.equal(offline.status, 0, offline.stderr);
  const ansiCsi = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, "g");
  const offlineOutput = offline.stdout.replace(ansiCsi, "");
  assert.match(offlineOutput, /downloaded\s+0/);
  assert.match(offlineOutput, /node_modules.*never.*index\.js/);
}

export async function assertNativePnpmArchiveRoundTrip(options: {
  fixture: string;
  hashMetadata: Buffer;
  markerOutPath: string;
  nix: string;
  outPath: string;
  root: string;
}): Promise<void> {
  const archived = await timedNativePnpmPhase(
    "fixture archive",
    async () =>
      await runGuardedCommand(options.nix, ["flake", "archive", "--json", "."], {
        cwd: options.fixture,
        env: nixEnv(path.join(options.root, "archive-home"), "materialize"),
        fixtureRoot: options.root,
      }),
  );
  assert.equal(archived.status, 0, archived.stderr);
  const archivedSource = String(JSON.parse(archived.stdout).path || "");
  assert.match(archivedSource, /^\/nix\/store\/[a-z0-9]{32}-source$/);
  for (const generatedRoot of [".nix-gcroots", ".viberoots", "buck-out"]) {
    await assert.rejects(fsp.access(path.join(archivedSource, generatedRoot)), { code: "ENOENT" });
  }
  const rematerialized = await timedNativePnpmPhase(
    "rematerialized build",
    async () =>
      await runGuardedCommand(options.nix, buildArgs(true), {
        cwd: options.fixture,
        env: nixEnv(path.join(options.root, "verify-home")),
        fixtureRoot: options.root,
      }),
  );
  assert.equal(rematerialized.status, 0, rematerialized.stderr);
  const rematerializedOutPath = rematerialized.stdout.trim().split(/\s+/).at(-1);
  assert.equal(rematerializedOutPath, options.outPath);
  assert.equal(rematerializedOutPath, options.markerOutPath);
  assert.deepEqual(
    await fsp.readFile(
      path.join(options.fixture, "build-tools", "tools", "nix", "node-modules.hashes.json"),
    ),
    options.hashMetadata,
  );
}
