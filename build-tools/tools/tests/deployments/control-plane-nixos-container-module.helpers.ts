#!/usr/bin/env zx-wrapper
import { pinnedNixpkgsOutPathExpr } from "../../lib/pinned-nixpkgs";
import { viberootsRepoPath } from "./deployment-command";

export type EvalOut = Record<string, unknown>;
const pinnedNixpkgsPathExpr = pinnedNixpkgsOutPathExpr(viberootsRepoPath("flake.lock"));

const credentialConfig = `
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
`;

export const REVIEWED_IMAGE_DIGEST =
  "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

export async function evalModule(
  tmp: string,
  $: any,
  moduleConfig: string,
  body: string,
  base: {
    image?: boolean;
    bucket?: boolean;
    credentials?: string;
    imports?: string[];
    extraConfig?: string;
  } = {},
): Promise<EvalOut> {
  const includeImage = base.image ?? true;
  const includeBucket = base.bucket ?? true;
  const credentials = base.credentials ?? credentialConfig;
  const imports = base.imports ?? [
    viberootsRepoPath(
      "viberoots/build-tools/tools/nix/deployment-control-plane-container-module.nix",
    ),
  ];
  const expr = `
    let
      nixpkgsPath = ${pinnedNixpkgsPathExpr};
      lib = import (nixpkgsPath + "/lib");
      system = import (nixpkgsPath + "/nixos") {
        configuration = {
          nixpkgs.hostPlatform = "x86_64-linux";
          imports = [ ${imports.join(" ")} ];
          system.stateVersion = "24.11";
          services.viberoots.deploymentControlPlaneContainer = {
            enable = true;
            instanceId = "mini";
            publicUrl = "https://deploy.example.test";
            ${includeBucket ? `artifactStore.bucket = "deployment-artifacts";` : ""}
            ${
              includeImage
                ? `image = "registry.example.com/platform/deployment-control-plane@${REVIEWED_IMAGE_DIGEST}";`
                : ""
            }
            ${credentials}
            ${moduleConfig}
          };
          ${base.extraConfig || ""}
        };
      };
    in ${body}
  `;
  const { stdout } = await $({ cwd: tmp })`nix eval --impure --expr ${expr} --json`;
  return JSON.parse(String(stdout || "{}")) as EvalOut;
}
