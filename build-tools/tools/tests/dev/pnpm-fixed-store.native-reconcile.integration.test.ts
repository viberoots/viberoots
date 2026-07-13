import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const PLACEHOLDER = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const MAX_KIB = 500 * 1024;
const COMMAND_TIMEOUT_MS = 150_000;

type CommandResult = { status: number | null; stdout: string; stderr: string };

function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
}

async function run(
  command: string,
  args: string[],
  opts: {
    cwd: string;
    env?: NodeJS.ProcessEnv;
    fixtureRoot: string;
  },
): Promise<CommandResult> {
  const beforeDisk = await diskUsedKib(opts.fixtureRoot);
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...(opts.env || {}) },
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    let stdout = "";
    let stderr = "";
    let stopped = false;
    child.stdout.on("data", (chunk) => (stdout += String(chunk)));
    child.stderr.on("data", (chunk) => (stderr += String(chunk)));

    const stop = (reason: Error) => {
      if (stopped) return;
      stopped = true;
      if (child.pid) {
        try {
          process.kill(process.platform === "win32" ? child.pid : -child.pid, "SIGTERM");
        } catch {}
      }
      reject(reason);
    };
    const timeout = setTimeout(
      () => stop(new Error(`command exceeded ${COMMAND_TIMEOUT_MS}ms: ${command}`)),
      COMMAND_TIMEOUT_MS,
    );
    const sampler = setInterval(async () => {
      try {
        const [fixtureKib, diskKib] = await Promise.all([
          directorySizeKib(opts.fixtureRoot),
          diskUsedKib(opts.fixtureRoot),
        ]);
        if (fixtureKib > MAX_KIB || diskKib - beforeDisk > MAX_KIB) {
          stop(
            new Error(
              `native reconcile exceeded 500 MiB guard: fixture=${fixtureKib}KiB diskDelta=${diskKib - beforeDisk}KiB`,
            ),
          );
        }
      } catch (error) {
        stop(error instanceof Error ? error : new Error(String(error)));
      }
    }, 1_000);
    child.on("error", stop);
    child.on("close", (status) => {
      clearTimeout(timeout);
      clearInterval(sampler);
      if (!stopped) resolve({ status, stdout, stderr });
    });
  });
}

async function directorySizeKib(target: string): Promise<number> {
  const output = await shellOutputUnbounded("du", ["-sk", target]);
  return Number.parseInt(output.split(/\s+/)[0] || "0", 10);
}

async function diskUsedKib(target: string): Promise<number> {
  const output = await shellOutputUnbounded("df", ["-k", target]);
  const fields = output.trim().split("\n").at(-1)?.trim().split(/\s+/) || [];
  return Number.parseInt(fields[2] || "0", 10);
}

async function shellOutputUnbounded(command: string, args: string[]): Promise<string> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += String(chunk)));
    child.stderr.on("data", (chunk) => (stderr += String(chunk)));
    child.on("error", reject);
    child.on("close", (status) =>
      status === 0 ? resolve(stdout.trim()) : reject(new Error(stderr || `${command} failed`)),
    );
  });
}

function strictGot(stderr: string): string {
  const matches = Array.from(stderr.matchAll(/^\s*got:\s*(sha256-[A-Za-z0-9+/]{43}=)\s*$/gm)).map(
    (match) => match[1],
  );
  assert.equal(matches.length, 1, `expected exactly one authoritative got line:\n${stderr}`);
  return matches[0];
}

async function writeFixture(root: string, nixpkgsPath: string): Promise<void> {
  await fsp.mkdir(root, { recursive: true });
  await fsp.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "tiny-native-reconcile",
      private: true,
      version: "0.0.0",
      dependencies: { never: "1.1.0" },
    }) + "\n",
  );
  await fsp.writeFile(
    path.join(root, "pnpm-lock.yaml"),
    [
      "lockfileVersion: '9.0'",
      "",
      "settings:",
      "  autoInstallPeers: true",
      "  excludeLinksFromLockfile: false",
      "",
      "importers:",
      "  .:",
      "    dependencies:",
      "      never:",
      "        specifier: 1.1.0",
      "        version: 1.1.0",
      "",
      "packages:",
      "  never@1.1.0:",
      "    resolution: {integrity: sha512-K0xfZVKUX7hrmbZKmyD1KB+PT8I9b9Ffxvmht8FhRjMIoe7/XyTfgyQko7G6RKvfnT9oxCrq0CARm1De5uXEbQ==}",
      "    engines: {node: '>=10.18.0 <11 || >=12.14.0 <13 || >=13.5.0'}",
      "",
      "snapshots:",
      "  never@1.1.0: {}",
      "",
    ].join("\n"),
  );
  await fsp.writeFile(
    path.join(root, "hashes.json"),
    JSON.stringify({ "pnpm-lock.yaml": PLACEHOLDER }) + "\n",
  );
  const sourceRoot = repoRoot();
  const system = `${process.arch === "arm64" ? "aarch64" : "x86_64"}-${process.platform === "darwin" ? "darwin" : "linux"}`;
  await fsp.writeFile(
    path.join(root, "flake.nix"),
    `{
  inputs.nixpkgs.url = ${JSON.stringify(`path:${nixpkgsPath}`)};
  outputs = { self, nixpkgs }:
    let
      system = ${JSON.stringify(system)};
      pkgs = import nixpkgs { inherit system; };
      store = import ${JSON.stringify(path.join(sourceRoot, "build-tools/tools/nix/node-modules/store.nix"))} {
        inherit pkgs;
        repoRoot = ./.;
        repoFsRoot = ./.;
        hashesPath = ./hashes.json;
        allowLiveHashMap = false;
      };
    in {
      packages.\${system} = {
        candidate = store.mkPnpmStore {
          lockfilePath = "pnpm-lock.yaml";
          importerDir = ".";
          packageJsonPath = "package.json";
        };
        pinnedPnpm = import ${JSON.stringify(path.join(sourceRoot, "build-tools/tools/nix/pnpm-11.nix"))} { inherit pkgs; };
      };
    };
}
`,
  );
}

function nixEnv(home: string): NodeJS.ProcessEnv {
  return {
    HOME: home,
    XDG_CACHE_HOME: path.join(home, "xdg-cache"),
    NIX_CONFIG: "experimental-features = nix-command flakes",
    NIX_PNPM_RECONCILE: "1",
    NIX_PNPM_FETCH_TIMEOUT: "120",
    NIX_PNPM_INSTALL_TIMEOUT: "120",
  };
}

function buildArgs(printOutPaths = false): string[] {
  return [
    "build",
    "--impure",
    "--no-link",
    "--no-write-lock-file",
    "--print-build-logs",
    ...(printOutPaths ? ["--print-out-paths"] : []),
    "--option",
    "keep-failed",
    "false",
    "--option",
    "min-free",
    "0",
    "--option",
    "max-free",
    "0",
    ".#candidate",
  ];
}

test(
  "native fixed pnpm reconciliation is deterministic and offline-consumable",
  { timeout: 180_000 },
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
      const archive = await run(nix, ["flake", "archive", "--json", lockedRef], {
        cwd: root,
        env: nixEnv(setupHome),
        fixtureRoot: root,
      });
      assert.equal(archive.status, 0, archive.stderr);
      const nixpkgsPath = JSON.parse(archive.stdout).path;
      assert.match(nixpkgsPath, /^\/nix\/store\/[a-z0-9]+-source$/);

      const fixtures = [path.join(root, "candidate-a"), path.join(root, "candidate-b")];
      await Promise.all(fixtures.map((fixture) => writeFixture(fixture, nixpkgsPath)));
      const candidates: string[] = [];
      for (const [index, fixture] of fixtures.entries()) {
        const home = path.join(root, `home-${index}`);
        await fsp.mkdir(home, { recursive: true });
        const result = await run(nix, buildArgs(), {
          cwd: fixture,
          env: nixEnv(home),
          fixtureRoot: root,
        });
        assert.notEqual(result.status, 0, "placeholder FOD build must report a mismatch");
        candidates.push(strictGot(result.stderr));
      }
      assert.equal(candidates[0], candidates[1]);

      await fsp.writeFile(
        path.join(fixtures[0], "hashes.json"),
        JSON.stringify({ "pnpm-lock.yaml": candidates[0] }) + "\n",
      );
      const final = await run(nix, buildArgs(true), {
        cwd: fixtures[0],
        env: nixEnv(path.join(root, "home-0")),
        fixtureRoot: root,
      });
      assert.equal(final.status, 0, final.stderr);
      const outPath = final.stdout.trim().split(/\s+/).at(-1) || "";
      assert.match(outPath, /^\/nix\/store\/[a-z0-9]+-pnpm-store-lock-[a-f0-9]{64}$/);

      const pinnedPnpm = await run(
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
      const offline = await run(
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
      assert.ok((await directorySizeKib(root)) < MAX_KIB);
    } finally {
      await fsp.rm(root, { recursive: true, force: true });
    }
  },
);
