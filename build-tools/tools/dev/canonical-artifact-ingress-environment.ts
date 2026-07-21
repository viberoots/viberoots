import path from "node:path";

import { buildArtifactEnvironment } from "../lib/artifact-environment";
import { assertNoArtifactSelectorInjection } from "../lib/artifact-environment-policy";
import { allDevOverrideEnvNames } from "../lib/dev-override-envs";

export function buildCanonicalIngressEnvironment(opts: {
  env: NodeJS.ProcessEnv;
  workspaceRoot: string;
  toolsRoot: string;
  wasmBackend: string;
}): NodeJS.ProcessEnv {
  const remainingIngressEnv = { ...opts.env };
  if (opts.wasmBackend) delete remainingIngressEnv.WEB_WASM_BACKEND;
  for (const name of allDevOverrideEnvNames()) delete remainingIngressEnv[name];
  assertNoArtifactSelectorInjection(remainingIngressEnv, {
    rejectUnknownArtifactAffecting: true,
  });
  return buildArtifactEnvironment({
    baseEnv: remainingIngressEnv,
    mode: String(remainingIngressEnv.CI || "").trim() ? "ci" : "local",
    stateRoot: path.join(opts.workspaceRoot, "buck-out", "tmp", "artifact-environment"),
    workspaceRoot: opts.workspaceRoot,
    artifactToolsRoot: opts.toolsRoot,
  });
}
