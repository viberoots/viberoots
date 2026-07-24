import path from "node:path";
import fs from "node:fs";

import {
  buildCanonicalArtifactEnvironment,
  canonicalArtifactToolsRoot,
  validateArtifactToolsRoot,
} from "../lib/artifact-environment";
import {
  canonicalDevOverrideArg,
  evaluationBundleDevOverrides,
  evaluationBundleWasmBackend,
  withoutCanonicalDevOverrideArgs,
} from "./evaluation-bundle-selectors";
import { canonicalBuckActionTransport } from "./canonical-buck-action-transport";
import { artifactWorkspaceRootTransport } from "./canonical-artifact-workspace-transport";
import { buildCanonicalIngressEnvironment } from "./canonical-artifact-ingress-environment";
import {
  activateCanonicalReviewedNixConfig,
  attachCanonicalReviewedNixConfig,
  canonicalArtifactEnvironmentDifferences,
  canonicalReviewedConfig,
  consumeArtifactIngressReviewedNixConfig,
  isCanonicalArtifactEntrypointEnvironment,
  type ReviewedNixConfigOutcome,
} from "./canonical-reviewed-nix-config";

export {
  consumeArtifactIngressReviewedNixConfig,
  isCanonicalArtifactEntrypointEnvironment,
} from "./canonical-reviewed-nix-config";

function canonicalZxInit(toolsRoot: string): string {
  const zxInit = path.join(
    toolsRoot,
    "share",
    "viberoots-source",
    "build-tools",
    "tools",
    "dev",
    "zx-init.mjs",
  );
  if (!fs.statSync(zxInit).isFile()) {
    throw new Error("canonical artifact tool authority is missing zx-init.mjs");
  }
  return zxInit;
}

function environmentBeforeCanonicalWrapper(
  canonicalEnv: NodeJS.ProcessEnv,
  toolsRoot: string,
): NodeJS.ProcessEnv {
  return { ...canonicalEnv, ZX_INIT: canonicalZxInit(toolsRoot) };
}

function environmentAfterCanonicalWrapper(
  canonicalEnv: NodeJS.ProcessEnv,
  toolsRoot: string,
): NodeJS.ProcessEnv {
  const yqBin = path.dirname(fs.realpathSync(path.join(toolsRoot, "bin", "yq")));
  return {
    ...environmentBeforeCanonicalWrapper(canonicalEnv, toolsRoot),
    PATH: `${yqBin}${path.delimiter}${canonicalEnv.PATH}`,
  };
}

export function canonicalArtifactReentryEnvironment(
  workspaceRoot: string,
  artifactToolsRoot: string,
  opts: { nixCacheHealth?: ReviewedNixConfigOutcome } = {},
): NodeJS.ProcessEnv {
  const toolsRoot = validateArtifactToolsRoot(
    artifactToolsRoot,
    "canonical re-entry tool authority",
  );
  return attachCanonicalReviewedNixConfig(
    {
      ...environmentBeforeCanonicalWrapper(
        buildCanonicalArtifactEnvironment(workspaceRoot, { artifactToolsRoot: toolsRoot }),
        toolsRoot,
      ),
      VBR_CANONICAL_ARTIFACT_ENTRYPOINT: "1",
    },
    opts.nixCacheHealth || { applied: false, config: "" },
  );
}

function canonicalWrapperPathIsIntact(toolsRoot: string): boolean {
  try {
    validateArtifactToolsRoot(toolsRoot, "canonical re-entry tool authority");
    const yqBin = path.dirname(fs.realpathSync(path.join(toolsRoot, "bin", "yq")));
    return process.env.PATH === `${yqBin}${path.delimiter}${path.join(toolsRoot, "bin")}`;
  } catch {
    return false;
  }
}

export function assertCanonicalArtifactReentry(assertedRoot: string, execPath: string): string {
  const toolsRoot = validateArtifactToolsRoot(assertedRoot, "canonical re-entry tool authority");
  if (fs.realpathSync(execPath) !== fs.realpathSync(path.join(toolsRoot, "bin", "node"))) {
    throw new Error(
      "canonical artifact re-entry executable does not match asserted tool authority",
    );
  }
  return toolsRoot;
}

export function enterCanonicalArtifactEntrypoint(
  workspaceRoot = process.cwd(),
  opts: {
    declaredBuckAction?: boolean;
    allowDevOverrides?: boolean;
  } = {},
): string {
  const ingressReviewedNixConfig = consumeArtifactIngressReviewedNixConfig();
  const originalArgs = process.argv.slice(2);
  const workspaceTransport = artifactWorkspaceRootTransport(originalArgs, workspaceRoot);
  const buckTransport = canonicalBuckActionTransport(
    workspaceTransport.argv,
    process.env,
    Boolean(opts.declaredBuckAction),
  );
  const wasmBackend = evaluationBundleWasmBackend(workspaceTransport.argv, process.env);
  const devOverrides = evaluationBundleDevOverrides(workspaceTransport.argv, process.env);
  if (!opts.allowDevOverrides && Object.keys(devOverrides).length > 0) {
    throw new Error("this artifact entrypoint does not admit development overrides");
  }
  const scopedWorkspaceRoot = opts.declaredBuckAction
    ? buckTransport.workspaceRoot
    : workspaceTransport.workspaceRoot;
  const declaredToolsRoot = opts.declaredBuckAction
    ? buckTransport.artifactToolsRoot
    : canonicalArtifactToolsRoot(scopedWorkspaceRoot);
  const assertedTools = String(process.env.VBR_ARTIFACT_TOOLS_ROOT || "").trim();
  const canonicalReentry = process.env.VBR_CANONICAL_ARTIFACT_ENTRYPOINT === "1";
  const reentryReviewed = canonicalReviewedConfig(process.env);
  const nixCacheHealth = canonicalReentry
    ? reentryReviewed.valid
      ? { applied: reentryReviewed.applied, config: reentryReviewed.config }
      : { applied: false, config: "" }
    : ingressReviewedNixConfig;
  const reentryTools = canonicalReentry
    ? assertCanonicalArtifactReentry(assertedTools, process.execPath)
    : "";
  const expectedReentryEnv = reentryTools
    ? environmentAfterCanonicalWrapper(
        buildCanonicalArtifactEnvironment(scopedWorkspaceRoot, {
          artifactToolsRoot: reentryTools,
        }),
        reentryTools,
      )
    : {};
  attachCanonicalReviewedNixConfig(expectedReentryEnv, nixCacheHealth);
  const reentryChecks = {
    asserted: Boolean(assertedTools),
    storeShape: /^\/nix\/store\/[a-z0-9]{32}-[^/]+$/u.test(assertedTools),
    assertedMatch: reentryTools === assertedTools,
    declaredMatch: reentryTools === declaredToolsRoot,
    wrapperPath: canonicalReentry && canonicalWrapperPathIsIntact(assertedTools),
    environment:
      canonicalReentry && isCanonicalArtifactEntrypointEnvironment(process.env, expectedReentryEnv),
    reviewedConfig: !canonicalReentry || reentryReviewed.valid,
    wasmEnvironmentEmpty: !String(process.env.WEB_WASM_BACKEND || "").trim(),
  };
  if (canonicalReentry && Object.values(reentryChecks).every(Boolean)) {
    process.argv = [...process.argv.slice(0, 2), ...workspaceTransport.argv];
    activateCanonicalReviewedNixConfig(process.env, nixCacheHealth);
    return assertedTools;
  }
  if (canonicalReentry) {
    const failed = Object.entries(reentryChecks)
      .filter(([, passed]) => !passed)
      .map(([name]) => name);
    const environmentDifferences = canonicalArtifactEnvironmentDifferences(
      process.env,
      expectedReentryEnv,
    );
    if (environmentDifferences.length) {
      failed.push(`environment[${environmentDifferences.join(",")}]`);
    }
    throw new Error(
      `canonical artifact re-entry has inconsistent tool authority or environment: ${failed.join(", ")}`,
    );
  }
  // Ordinary ingress resolves the workspace-scoped manifest. Buck actions use
  // the tool closure and workspace root validated from declared action inputs.
  const toolsRoot = declaredToolsRoot;
  const canonicalNode = path.join(toolsRoot, "bin", "node");
  const canonicalEnv = buildCanonicalIngressEnvironment({
    env: buckTransport.env,
    workspaceRoot: scopedWorkspaceRoot,
    toolsRoot,
    wasmBackend,
  });
  const activeCanonicalEnv = environmentAfterCanonicalWrapper(canonicalEnv, toolsRoot);
  attachCanonicalReviewedNixConfig(activeCanonicalEnv, nixCacheHealth);
  if (
    fs.realpathSync(process.execPath) === fs.realpathSync(canonicalNode) &&
    isCanonicalArtifactEntrypointEnvironment(process.env, activeCanonicalEnv)
  ) {
    process.argv = [...process.argv.slice(0, 2), ...workspaceTransport.argv];
    activateCanonicalReviewedNixConfig(process.env, nixCacheHealth);
    return toolsRoot;
  }
  const wrapper = path.join(toolsRoot, "bin", "zx-wrapper");
  const script = String(process.argv[1] || "").trim();
  if (!script) throw new Error("canonical artifact entrypoint requires a script path");
  const env = canonicalArtifactReentryEnvironment(scopedWorkspaceRoot, toolsRoot, {
    nixCacheHealth,
  });
  const argsWithoutDevOverrides = withoutCanonicalDevOverrideArgs(buckTransport.argv);
  const wasmArgs = argsWithoutDevOverrides.some(
    (arg) => arg === "--wasm-backend" || arg.startsWith("--wasm-backend="),
  )
    ? argsWithoutDevOverrides
    : [...argsWithoutDevOverrides, ...(wasmBackend ? [`--wasm-backend=${wasmBackend}`] : [])];
  const devOverrideArg = canonicalDevOverrideArg(devOverrides);
  const workspaceArgs = opts.declaredBuckAction ? [] : [workspaceTransport.transportArg];
  const canonicalArgs = [
    ...workspaceArgs,
    ...wasmArgs,
    ...(devOverrideArg ? [devOverrideArg] : []),
  ];
  process.execve(wrapper, [wrapper, script, ...canonicalArgs], env);
  throw new Error("canonical artifact entrypoint re-exec unexpectedly returned");
}
