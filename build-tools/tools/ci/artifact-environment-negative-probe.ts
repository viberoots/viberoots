#!/usr/bin/env zx-wrapper
import { enterCanonicalArtifactEntrypoint } from "../dev/canonical-artifact-entrypoint";
import { buildCanonicalArtifactEnvironment } from "../lib/artifact-environment";

const artifactToolsRoot = enterCanonicalArtifactEntrypoint();
buildCanonicalArtifactEnvironment(process.cwd(), { artifactToolsRoot });
throw new Error("negative probe expected hostile artifact selector rejection");
