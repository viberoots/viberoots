#!/usr/bin/env zx-wrapper
import { getFlagStr } from "../lib/cli";
import { enterCanonicalArtifactEntrypoint } from "./canonical-artifact-entrypoint";
import { buildSelectedOutPath } from "./run-runnable-graph";

const artifactToolsRoot = enterCanonicalArtifactEntrypoint();
mainWithAuthority(artifactToolsRoot).catch((error) => {
  console.error(error);
  process.exit(1);
});

async function mainWithAuthority(artifactToolsRoot: string): Promise<void> {
  const target = getFlagStr("target", "").trim();
  const source = getFlagStr("source", "auto").trim();
  if (!target || !["auto", "git", "path"].includes(source)) {
    throw new Error("canonical runnable artifact requires --target and --source=auto|git|path");
  }
  const outPath = await buildSelectedOutPath(
    process.cwd(),
    target,
    source as "auto" | "git" | "path",
    { artifactToolsRoot },
  );
  process.stdout.write(`${outPath}\n`);
}
