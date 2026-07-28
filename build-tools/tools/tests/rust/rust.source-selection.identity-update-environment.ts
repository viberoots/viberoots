import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { applyNixCacheHealthPolicy } from "../../dev/verify/nix-cache-health";
import {
  buildArtifactEnvironment,
  withoutArtifactEnvironmentInfluence,
} from "../../lib/artifact-environment";
import { nixCachePolicyBindingDigest } from "../../lib/nix-cache-policy-capability";
import { ensureNixStoreToolPathSync } from "../../lib/tool-paths";

const execFileAsync = promisify(execFile);

export async function rustIdentityUpdateEnvironment(
  workspace: string,
  artifactToolsRoot: string,
): Promise<NodeJS.ProcessEnv> {
  const cacheHealth = await applyNixCacheHealthPolicy(workspace);
  const policy = String(process.env.VBR_NIX_CACHE_HEALTH_REVIEWED_POLICY || "").trim();
  if (cacheHealth.authority !== "reviewed" || (policy !== "auto" && policy !== "strict")) {
    throw new Error("Rust identity update requires reviewed Nix cache configuration");
  }
  const reviewed = {
    kind: "reviewed" as const,
    config: cacheHealth.nixConfig,
    policy,
    requiredSubstituters: cacheHealth.requiredSubstituters,
    optionalSubstituters: cacheHealth.optionalSubstituters,
  };
  const env = buildArtifactEnvironment({
    baseEnv: withoutArtifactEnvironmentInfluence(process.env),
    mode: String(process.env.CI || "").trim() ? "ci" : "local",
    stateRoot: path.join(workspace, "buck-out", "tmp", "rust-identity-update-environment"),
    workspaceRoot: workspace,
    artifactToolsRoot,
  });
  env.NIX_CONFIG = reviewed.config;
  env.VBR_NIX_CACHE_ROLE_REQUIRED = reviewed.requiredSubstituters.join(" ");
  env.VBR_NIX_CACHE_ROLE_OPTIONAL = reviewed.optionalSubstituters.join(" ");
  env.VBR_NIX_CACHE_ROLE_POLICY = reviewed.policy;
  env.VBR_NIX_CACHE_ROLE_BINDING = nixCachePolicyBindingDigest(reviewed);
  const nixBin = ensureNixStoreToolPathSync("nix", env);
  env.NIX_BIN = nixBin;
  env.PATH = `${path.dirname(nixBin)}${path.delimiter}${env.PATH}`;
  await execFileAsync(nixBin, ["config", "show"], {
    cwd: workspace,
    env,
    maxBuffer: 16 * 1024 * 1024,
  });
  return env;
}
