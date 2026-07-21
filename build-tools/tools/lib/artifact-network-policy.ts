export type ArtifactNetworkSourcePolicy = {
  file: string;
  primitive: string;
  ownership: "fixed-output" | "runtime-health-check";
};

export const ARTIFACT_NETWORK_SOURCE_POLICY: readonly ArtifactNetworkSourcePolicy[] = [
  {
    file: "build-tools/tools/nix/devshell.nix",
    primitive: "fetchurl",
    ownership: "fixed-output",
  },
  {
    file: "build-tools/tools/nix/pnpm-11.nix",
    primitive: "fetchurl",
    ownership: "fixed-output",
  },
  {
    file: "build-tools/tools/nix/toolchains/python-wasi.nix",
    primitive: "fetchurl",
    ownership: "fixed-output",
  },
  {
    file: "build-tools/tools/nix/toolchains/pyodide.nix",
    primitive: "fetchurl",
    ownership: "fixed-output",
  },
  {
    file: "build-tools/tools/nix/node-modules/store.nix",
    primitive: "pnpm fetch",
    ownership: "fixed-output",
  },
  {
    file: "build-tools/tools/nix/shared-host-identity-provider-migration.nix",
    primitive: "curl",
    ownership: "runtime-health-check",
  },
  {
    file: "build-tools/tools/lib/pinned-nixpkgs.ts",
    primitive: "fetchTree",
    ownership: "fixed-output",
  },
] as const;
