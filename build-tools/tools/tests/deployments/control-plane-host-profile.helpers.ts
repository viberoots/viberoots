#!/usr/bin/env zx-wrapper
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseControlPlaneRuntimeConfig } from "../../deployments/control-plane-runtime-config";
import { REVIEWED_IMAGE_DIGEST } from "./control-plane-nixos-container-module.helpers";
import { viberootsRepoPath } from "./deployment-command";

const execFileAsync = promisify(execFile);

export type NixosDefaults = Record<string, string | number | boolean>;

export async function loadNixosDefaults(): Promise<NixosDefaults> {
  const { stdout } = await execFileAsync(
    "nix",
    [
      "eval",
      "--json",
      "--impure",
      "--expr",
      `import ${viberootsRepoPath("viberoots/build-tools/tools/nix/deployment-control-plane-container-defaults.nix")}`,
    ],
    { cwd: process.cwd(), maxBuffer: 1024 * 1024 },
  );
  return JSON.parse(stdout) as NixosDefaults;
}

export async function loadNixosRenderedConfig(): Promise<
  ReturnType<typeof parseControlPlaneRuntimeConfig>
> {
  const expr = `
    let
      system = import <nixpkgs/nixos> {
        configuration = {
          nixpkgs.hostPlatform = "x86_64-linux";
          imports = [ ${viberootsRepoPath("viberoots/build-tools/tools/nix/deployment-control-plane-container-module.nix")} ];
          system.stateVersion = "24.11";
          services.viberoots.deploymentControlPlaneContainer = {
            enable = true;
            instanceId = "mini";
            publicUrl = "https://deploy.example.test";
            artifactStore.bucket = "deployment-control-plane-artifacts";
            image = "registry.example.com/platform/deployment-control-plane@${REVIEWED_IMAGE_DIGEST}";
            credentials = {
              control-plane-database-url.source = "/run/secrets/db";
              control-plane-token.source = "/run/secrets/control-plane-token";
              reviewed-source-ssh-key.source = "/run/secrets/ssh";
              reviewed-source-known-hosts.source = "/run/secrets/known-hosts";
              cloud-control-fixture-staging-infisical-client-id.source = "/run/secrets/infisical-id";
              cloud-control-fixture-staging-infisical-client-secret.source = "/run/secrets/infisical-secret";
              artifact-store-endpoint.source = "/run/secrets/endpoint";
              artifact-store-access-key-id.source = "/run/secrets/access";
              artifact-store-secret-access-key.source = "/run/secrets/secret";
            };
          };
        };
      };
    in system.config.environment.etc."deployment-control-plane/config.yaml".text
  `;
  const { stdout } = await execFileAsync("nix", ["eval", "--raw", "--impure", "--expr", expr], {
    cwd: process.cwd(),
    maxBuffer: 1024 * 1024,
  });
  return parseControlPlaneRuntimeConfig(stdout);
}
