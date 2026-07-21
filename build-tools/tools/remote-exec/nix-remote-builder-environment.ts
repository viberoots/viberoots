import path from "node:path";
import { buildArtifactEnvironment, canonicalArtifactToolsRoot } from "../lib/artifact-environment";

export function remoteCiToolsPathEnv(
  remoteCiTools: string,
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  if (!remoteCiTools) {
    throw new Error("remote-ci-tools is required for a remote artifact environment");
  }
  if (!remoteCiTools.startsWith("/nix/store/")) {
    throw new Error(`remote-ci-tools must be a Nix store path: ${remoteCiTools}`);
  }
  const canonicalTools = canonicalArtifactToolsRoot(process.cwd());
  if (path.resolve(remoteCiTools) !== canonicalTools) {
    throw new Error(
      `remote-ci-tools must equal the canonical generated artifact tool authority: expected=${canonicalTools} actual=${remoteCiTools}`,
    );
  }
  return buildArtifactEnvironment({
    baseEnv: { ...baseEnv, PATH: `${remoteCiTools}/bin` },
    mode: "remote",
    stateRoot: path.join(process.cwd(), "buck-out", "tmp", "remote-artifact-environment"),
    workspaceRoot: process.cwd(),
    artifactToolsRoot: remoteCiTools,
  });
}
