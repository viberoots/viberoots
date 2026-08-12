import { runArtifactTool } from "./artifact-command";

const REVISION = /^[a-f0-9]{40,64}$/u;

export async function resolveArtifactRevisionDomains(opts: {
  workspaceRoot: string;
  artifactToolsRoot: string;
}): Promise<{ sourceRevision: string; toolSourceRevision: string }> {
  return await resolveRevisionDomainsWithGit(async (args) =>
    (
      await runArtifactTool({
        tool: "git",
        args,
        workspaceRoot: opts.workspaceRoot,
        artifactToolsRoot: opts.artifactToolsRoot,
      })
    ).stdout.trim(),
  );
}

export async function resolveRevisionDomainsWithGit(
  runGit: (args: string[]) => Promise<string>,
): Promise<{ sourceRevision: string; toolSourceRevision: string }> {
  const [sourceRevision, toolSourceRevision] = await Promise.all([
    runGit(["rev-parse", "HEAD"]),
    runGit(["-C", "viberoots", "rev-parse", "HEAD"]),
  ]);
  if (!REVISION.test(sourceRevision) || !REVISION.test(toolSourceRevision)) {
    throw new Error("artifact evidence requires consumer and tool checkout revisions");
  }
  return { sourceRevision, toolSourceRevision };
}
