import * as fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PLACEHOLDER = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

export function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
}

export async function writeFixture(
  root: string,
  nixpkgsPath: string,
  viberootsPath: string,
): Promise<void> {
  await fsp.mkdir(path.join(root, "build-tools", "tools", "dev"), { recursive: true });
  await fsp.mkdir(path.join(root, "build-tools", "tools", "nix"), { recursive: true });
  await fsp.writeFile(path.join(root, "build-tools", "tools", "dev", "zx-init.mjs"), "\n");
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
}

export function nixEnv(
  home: string,
  authority: "reconcile" | "materialize" = "reconcile",
): NodeJS.ProcessEnv {
  return {
    HOME: home,
    XDG_CACHE_HOME: path.join(home, "xdg-cache"),
    NIX_CONFIG: "experimental-features = nix-command flakes",
    ...(authority === "reconcile" ? { NIX_PNPM_RECONCILE: "1" } : { NIX_PNPM_MATERIALIZE: "1" }),
    NIX_PNPM_FETCH_TIMEOUT: "120",
    NIX_PNPM_INSTALL_TIMEOUT: "120",
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
