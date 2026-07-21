import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { externalNodeToolEnv } from "../../lib/external-node-env";
import { resolveWorkspaceRootSync } from "../../lib/repo";
import { resolveToolPathSync } from "../../lib/tool-paths";
import { NATIVE_PNPM_COMMAND_TIMEOUT_MS } from "./pnpm-fixed-store-native-run";
import { fileURLToPath } from "node:url";

export const PLACEHOLDER = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const execFileAsync = promisify(execFile);

export function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
}

export async function writeFixture(
  root: string,
  nixpkgsPath: string,
  viberootsPath: string,
): Promise<void> {
  await fsp.mkdir(path.join(root, "build-tools", "tools", "dev"), { recursive: true });
  await fsp.mkdir(path.join(root, ".viberoots", "workspace"), { recursive: true });
  await fsp.mkdir(path.join(root, "build-tools", "tools", "nix"), { recursive: true });
  await fsp.writeFile(path.join(root, "build-tools", "tools", "dev", "zx-init.mjs"), "\n");
  // The reconcile derivation invokes viberoots JS helpers that resolve the
  // canonical artifact tool authority. Stage the live workspace's
  // toolchain-paths.json into the fixture so the fixture root can play the
  // role of workspace root explicitly, rather than relying on an ambient
  // fallback.
  await fsp.copyFile(
    path.join(
      resolveWorkspaceRootSync(process.cwd()),
      ".viberoots",
      "workspace",
      "toolchain-paths.json",
    ),
    path.join(root, ".viberoots", "workspace", "toolchain-paths.json"),
  );
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
    path.join(root, "build-tools", "tools", "nix", "node-modules.hashes.json"),
    JSON.stringify({ "pnpm-lock.yaml": PLACEHOLDER }) + "\n",
  );
  const system = `${process.arch === "arm64" ? "aarch64" : "x86_64"}-${process.platform === "darwin" ? "darwin" : "linux"}`;
  await fsp.writeFile(
    path.join(root, "flake.nix"),
    `{
  inputs.nixpkgs.url = ${JSON.stringify(`path:${nixpkgsPath}`)};
  inputs.viberoots.url = ${JSON.stringify(`path:${viberootsPath}`)};
  outputs = { self, nixpkgs, viberoots }:
    let
      system = ${JSON.stringify(system)};
      pkgs = import nixpkgs { inherit system; };
      store = import ${JSON.stringify(path.join(viberootsPath, "build-tools/tools/nix/node-modules/store.nix"))} {
        inherit pkgs;
        repoRoot = ./.;
        repoFsRoot = ./.;
        hashesPath = ./build-tools/tools/nix/node-modules.hashes.json;
        allowLiveHashMap = false;
      };
      candidate = store.mkPnpmStore {
        lockfilePath = "pnpm-lock.yaml";
        importerDir = ".";
        packageJsonPath = "package.json";
      };
    in {
      packages.${system} = {
        inherit candidate;
        pnpm-store.default = candidate;
        pinnedPnpm = import ${JSON.stringify(path.join(viberootsPath, "build-tools/tools/nix/pnpm-11.nix"))} { inherit pkgs; };
      };
    };
}
`,
  );
  await fsp.writeFile(
    path.join(root, ".gitignore"),
    ["/.nix-gcroots/", "/.viberoots/", "/buck-out/", "/result", "/result-*", ""].join("\n"),
  );
  const git = resolveToolPathSync("git");
  await execFileAsync(git, ["init", "-q"], { cwd: root, env: externalNodeToolEnv() });
  await execFileAsync(
    git,
    ["add", "--", ".gitignore", "build-tools", "flake.nix", "package.json", "pnpm-lock.yaml"],
    { cwd: root, env: externalNodeToolEnv() },
  );
}

export async function stageFixtureLock(root: string): Promise<void> {
  await execFileAsync(resolveToolPathSync("git"), ["add", "--", "flake.lock"], {
    cwd: root,
    env: externalNodeToolEnv(),
  });
}

export function nixEnv(
  home: string,
  authority: "reconcile" | "materialize" = "reconcile",
): NodeJS.ProcessEnv {
  return {
    ...externalNodeToolEnv(),
    HOME: home,
    XDG_CACHE_HOME: path.join(home, "xdg-cache"),
    NIX_CONFIG: "experimental-features = nix-command flakes",
    ...(authority === "reconcile" ? { NIX_PNPM_RECONCILE: "1" } : { NIX_PNPM_MATERIALIZE: "1" }),
    NIX_PNPM_FETCH_TIMEOUT: String(NATIVE_PNPM_COMMAND_TIMEOUT_MS / 1000),
    NIX_PNPM_INSTALL_TIMEOUT: String(NATIVE_PNPM_COMMAND_TIMEOUT_MS / 1000),
  };
}

export function buildArgs(printOutPaths = false): string[] {
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
