#!/usr/bin/env zx-wrapper
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseControlPlaneRuntimeConfig } from "../../deployments/control-plane-runtime-config";

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
      "import ./build-tools/tools/nix/deployment-control-plane-container-defaults.nix",
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
          imports = [ ./build-tools/tools/nix/deployment-control-plane-container-module.nix ];
          system.stateVersion = "24.11";
          services.viberoots.deploymentControlPlaneContainer = {
            enable = true;
            instanceId = "mini";
            publicUrl = "https://deploy.example.test";
            artifactStore.bucket = "deployment-control-plane-artifacts";
            image = "registry.example.com/platform/deployment-control-plane@sha256:reviewed";
            credentials = {
              control-plane-database-url.source = "/run/secrets/db";
              reviewed-source-ssh-key.source = "/run/secrets/ssh";
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
