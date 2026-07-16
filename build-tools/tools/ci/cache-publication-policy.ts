import { classifyArtifactBuild } from "../lib/artifact-build-policy";
import {
  admitArtifactContext,
  inspectWorkspaceArtifactSource,
} from "../dev/artifact-policy-inspection";

export async function admitCachePublication(opts: {
  env: NodeJS.ProcessEnv;
  diagnosticImpure: boolean;
  toolNames?: string[];
}): Promise<void> {
  const sourceInventory = await inspectWorkspaceArtifactSource({
    workspaceRoot: process.cwd(),
    targetPackages: [],
    env: opts.env,
  });
  await admitArtifactContext({
    classification: classifyArtifactBuild({
      diagnosticImpure: opts.diagnosticImpure,
      localDevelopment: sourceInventory.localDevelopment,
    }),
    purpose: "cache-publication",
    impureEvaluation: true,
    env: opts.env,
    workspaceRoot: process.cwd(),
    toolNames: ["git", ...(opts.toolNames || [])],
  });
}
