#!/usr/bin/env zx-wrapper

export type EvalOut = Record<string, unknown>;

const credentialConfig = `
  credentials = {
    control-plane-database-url.source = "/run/secrets/db";
    control-plane-token.source = "/run/secrets/control-plane-token";
    reviewed-source-ssh-key.source = "/run/secrets/ssh";
    artifact-store-endpoint.source = "/run/secrets/endpoint";
    artifact-store-access-key-id.source = "/run/secrets/access";
    artifact-store-secret-access-key.source = "/run/secrets/secret";
  };
`;

export async function evalModule(
  tmp: string,
  $: any,
  moduleConfig: string,
  body: string,
  base: { image?: boolean; bucket?: boolean; credentials?: string } = {},
): Promise<EvalOut> {
  const includeImage = base.image ?? true;
  const includeBucket = base.bucket ?? true;
  const credentials = base.credentials ?? credentialConfig;
  const expr = `
    let
      lib = import <nixpkgs/lib>;
      system = import <nixpkgs/nixos> {
        configuration = {
          nixpkgs.hostPlatform = "x86_64-linux";
          imports = [ ./build-tools/tools/nix/deployment-control-plane-container-module.nix ];
          system.stateVersion = "24.11";
          services.viberoots.deploymentControlPlaneContainer = {
            enable = true;
            instanceId = "mini";
            publicUrl = "https://deploy.example.test";
            ${includeBucket ? `artifactStore.bucket = "deployment-artifacts";` : ""}
            ${
              includeImage
                ? `image = "registry.example.com/platform/deployment-control-plane@sha256:reviewed";`
                : ""
            }
            ${credentials}
            ${moduleConfig}
          };
        };
      };
    in ${body}
  `;
  const { stdout } = await $({ cwd: tmp })`nix eval --impure --expr ${expr} --json`;
  return JSON.parse(String(stdout || "{}")) as EvalOut;
}
