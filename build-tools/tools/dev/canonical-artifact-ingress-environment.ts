import path from "node:path";

import {
  buildArtifactEnvironment,
  withoutArtifactEnvironmentInfluence,
} from "../lib/artifact-environment";
import { assertNoArtifactSelectorInjection } from "../lib/artifact-environment-policy";
import { allDevOverrideEnvNames } from "../lib/dev-override-envs";

export function buildCanonicalIngressEnvironment(opts: {
  env: NodeJS.ProcessEnv;
  workspaceRoot: string;
  toolsRoot: string;
  wasmBackend: string;
  stripAmbientArtifactInfluence?: boolean;
}): NodeJS.ProcessEnv {
  const remainingIngressEnv = { ...opts.env };
  if (opts.wasmBackend) delete remainingIngressEnv.WEB_WASM_BACKEND;
  for (const name of allDevOverrideEnvNames()) delete remainingIngressEnv[name];
  const ingressEnv = opts.stripAmbientArtifactInfluence
    ? withoutArtifactEnvironmentInfluence(remainingIngressEnv)
    : remainingIngressEnv;
  if (opts.stripAmbientArtifactInfluence && remainingIngressEnv.NIX_BUILD_CORES) {
    ingressEnv.NIX_BUILD_CORES = remainingIngressEnv.NIX_BUILD_CORES;
  }
  assertNoArtifactSelectorInjection(ingressEnv, { rejectUnknownArtifactAffecting: true });
  return buildArtifactEnvironment({
    baseEnv: ingressEnv,
    mode: String(ingressEnv.CI || "").trim() ? "ci" : "local",
    stateRoot: path.join(opts.workspaceRoot, "buck-out", "tmp", "artifact-environment"),
    workspaceRoot: opts.workspaceRoot,
    artifactToolsRoot: opts.toolsRoot,
  });
}
