#!/usr/bin/env zx-wrapper
import { runDevBuild } from "./dev-build/run-dev-build";
import { withRegisteredToolState } from "./registered-tool-state";
import { enterCanonicalArtifactEntrypoint } from "./canonical-artifact-entrypoint";

const artifactToolsRoot = enterCanonicalArtifactEntrypoint(process.cwd(), {
  allowDevOverrides: true,
});
withRegisteredToolState("dev-build", () => runDevBuild(artifactToolsRoot)).catch((e) => {
  console.error(e);
  process.exit(1);
});
