import path from "node:path";
import fs from "node:fs";
import {
  ARTIFACT_SELECTORS,
  assertNoArtifactSelectorInjection,
  isArtifactAffectingEnvName,
  withoutArtifactEnvironmentInfluence,
} from "./artifact-environment-policy";
import { canonicalArtifactToolsRoot, validateArtifactToolsRoot } from "./artifact-tool-authority";
import {
  nixCachePolicyBindingDigest,
  outcomeFromNixCachePolicyCapability,
  type NixCachePolicyCapability,
} from "./nix-cache-policy-capability";
import {
  ARTIFACT_TRANSPORT_ENV,
  assertCanonicalArtifactTransport,
} from "./artifact-environment-transport";

export {
  artifactSelectorNames,
  assertNoArtifactSelectorInjection,
  isArtifactAffectingEnvName,
  withoutArtifactEnvironmentInfluence,
} from "./artifact-environment-policy";
export {
  canonicalArtifactToolsRoot,
  MissingGeneratedArtifactToolAuthorityError,
  REQUIRED_ARTIFACT_TOOL_BINARIES,
  UnavailableGeneratedArtifactToolAuthorityError,
  validateArtifactToolsRoot,
} from "./artifact-tool-authority";
export { artifactTransportEnvironment } from "./artifact-environment-transport";

export type ArtifactEnvironmentMode = "local" | "ci" | "remote";

const CANONICAL_ARTIFACT_ENV_KEYS = new Set([
  "HOME",
  "LANG",
  "LC_ALL",
  "NIX_REMOTE",
  "NIX_SSL_CERT_FILE",
  "NODE_COMPILE_CACHE",
  "PATH",
  "SSL_CERT_FILE",
  "SOURCE_DATE_EPOCH",
  "TMPDIR",
  "TZ",
  "VBR_ARTIFACT_TOOLS_ROOT",
  "VBR_NIX_BIN",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
]);

export function artifactNodeCompileCachePath(
  stateRoot: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const name = platform === "darwin" ? "node-compile-cache.noindex" : "node-compile-cache";
  return path.join(stateRoot, "tmp", name);
}

export function buildArtifactEnvironment(opts: {
  baseEnv: NodeJS.ProcessEnv;
  mode: ArtifactEnvironmentMode;
  stateRoot: string;
  workspaceRoot: string;
  artifactToolsRoot?: string;
  internal?: NodeJS.ProcessEnv;
  nixCachePolicyCapability?: NixCachePolicyCapability;
}): NodeJS.ProcessEnv {
  const hasCachePolicyCapability = Object.prototype.hasOwnProperty.call(
    opts,
    "nixCachePolicyCapability",
  );
  if (
    hasCachePolicyCapability &&
    Object.prototype.hasOwnProperty.call(opts.internal || {}, "NIX_CONFIG") &&
    opts.internal?.NIX_CONFIG !== undefined
  ) {
    throw new Error(
      "artifact environment internal NIX_CONFIG cannot override Nix cache policy authority",
    );
  }
  const reservedInternal = Object.entries(opts.internal || {})
    .filter(([name, value]) => value !== undefined && CANONICAL_ARTIFACT_ENV_KEYS.has(name))
    .map(([name]) => name)
    .sort();
  if (reservedInternal.length > 0) {
    throw new Error(
      `artifact environment internal inputs cannot override canonical keys: ${reservedInternal.join(", ")}`,
    );
  }
  const artifactToolsRoot = opts.artifactToolsRoot
    ? validateArtifactToolsRoot(opts.artifactToolsRoot, "declared artifact tool authority")
    : canonicalArtifactToolsRoot(
        opts.workspaceRoot,
        String(opts.baseEnv.VBR_ARTIFACT_TOOLS_ROOT || ""),
      );
  const artifactCertificateFile = assertCanonicalArtifactTransport(opts.baseEnv, artifactToolsRoot);
  if (opts.mode === "ci") {
    const reviewed = new Set([
      ...ARTIFACT_TRANSPORT_ENV,
      ...ARTIFACT_SELECTORS,
      "NIX_REMOTE",
      "NIX_SSL_CERT_FILE",
      "SSL_CERT_FILE",
      ...Object.keys(opts.internal || {}),
    ]);
    const unknown = Object.entries(opts.baseEnv)
      .filter(
        ([name, value]) =>
          Boolean(String(value || "").trim()) &&
          isArtifactAffectingEnvName(name) &&
          !reviewed.has(name),
      )
      .map(([name]) => name)
      .sort();
    if (unknown.length > 0) {
      throw new Error(
        `CI artifact build rejects unreviewed artifact environment: ${unknown.join(", ")}; classify as transport or declare in the evaluation bundle`,
      );
    }
  }
  const allowedSelectors = Object.keys(opts.internal || {});
  if (opts.baseEnv.VBR_ARTIFACT_TOOLS_ROOT === artifactToolsRoot) {
    allowedSelectors.push("VBR_ARTIFACT_TOOLS_ROOT");
  }
  assertNoArtifactSelectorInjection(opts.baseEnv, {
    allow: allowedSelectors,
  });
  for (const rel of ["home", "tmp", "xdg-cache", "xdg-config", "xdg-data"]) {
    fs.mkdirSync(path.join(opts.stateRoot, rel), { recursive: true });
  }
  const nodeCompileCache = artifactNodeCompileCachePath(opts.stateRoot);
  fs.mkdirSync(nodeCompileCache, { recursive: true });
  const bootstrapNix = "/nix/var/nix/profiles/default/bin/nix";
  const nixBin = (() => {
    try {
      fs.accessSync(bootstrapNix, fs.constants.X_OK);
      return bootstrapNix;
    } catch {
      return path.join(artifactToolsRoot, "bin", "nix");
    }
  })();
  const out: NodeJS.ProcessEnv = {
    HOME: path.join(opts.stateRoot, "home"),
    TMPDIR: path.join(opts.stateRoot, "tmp"),
    XDG_CACHE_HOME: path.join(opts.stateRoot, "xdg-cache"),
    XDG_CONFIG_HOME: path.join(opts.stateRoot, "xdg-config"),
    XDG_DATA_HOME: path.join(opts.stateRoot, "xdg-data"),
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    TZ: "UTC",
    SOURCE_DATE_EPOCH: "1",
    PATH: path.join(artifactToolsRoot, "bin"),
    VBR_ARTIFACT_TOOLS_ROOT: artifactToolsRoot,
    VBR_NIX_BIN: nixBin,
    NIX_REMOTE: "daemon",
    NODE_COMPILE_CACHE: nodeCompileCache,
    NIX_SSL_CERT_FILE: artifactCertificateFile,
    SSL_CERT_FILE: artifactCertificateFile,
  };
  for (const [name, value] of Object.entries(opts.baseEnv)) {
    if (value === undefined) continue;
    if (ARTIFACT_TRANSPORT_ENV.has(name)) {
      out[name] = value;
    }
  }
  for (const [name, value] of Object.entries(opts.internal || {})) {
    if (value !== undefined) out[name] = value;
  }
  if (hasCachePolicyCapability) {
    const policy = outcomeFromNixCachePolicyCapability(opts.nixCachePolicyCapability);
    if (policy.kind === "reviewed") {
      out.NIX_CONFIG = policy.config;
      out.VBR_NIX_CACHE_POLICY = policy.policy;
      out.VBR_NIX_CACHE_ROLE_REQUIRED = policy.requiredSubstituters.join(" ");
      out.VBR_NIX_CACHE_ROLE_OPTIONAL = policy.optionalSubstituters.join(" ");
      out.VBR_NIX_CACHE_ROLE_POLICY = policy.policy;
      out.VBR_NIX_CACHE_ROLE_BINDING = nixCachePolicyBindingDigest(policy);
    } else {
      delete out.NIX_CONFIG;
      out.VBR_NIX_CACHE_POLICY = "off";
      delete out.VBR_NIX_CACHE_ROLE_REQUIRED;
      delete out.VBR_NIX_CACHE_ROLE_OPTIONAL;
      delete out.VBR_NIX_CACHE_ROLE_POLICY;
      delete out.VBR_NIX_CACHE_ROLE_BINDING;
    }
  }
  for (const selector of ARTIFACT_SELECTORS) {
    if (!Object.prototype.hasOwnProperty.call(opts.internal || {}, selector)) delete out[selector];
  }
  // This authority is generated above from the committed tool manifest, never inherited.
  out.VBR_ARTIFACT_TOOLS_ROOT = artifactToolsRoot;
  if (!out.PATH) throw new Error("artifact build requires a Nix-store-only PATH");
  if (opts.mode === "remote") {
    delete out.TERM;
    delete out.SSL_CERT_FILE;
  }
  return out;
}

export function buildCanonicalArtifactEnvironment(
  workspaceRoot: string,
  opts: { artifactToolsRoot: string },
): NodeJS.ProcessEnv {
  // The caller must have already resolved and validated the tool authority
  // via canonicalArtifactToolsRoot at ingress). Do not read process.env inside
  // this constructor: an ingress decision belongs at the caller's boundary.
  const asserted = String(opts.artifactToolsRoot || "").trim();
  if (!asserted) {
    throw new Error(
      "buildCanonicalArtifactEnvironment requires an explicit artifactToolsRoot; " +
        "resolve it at the ingress boundary before calling.",
    );
  }
  const baseEnv = withoutArtifactEnvironmentInfluence(process.env);
  return buildArtifactEnvironment({
    baseEnv,
    mode: String(baseEnv.CI || "").trim() ? "ci" : "local",
    stateRoot: path.join(workspaceRoot, "buck-out", "tmp", "artifact-environment"),
    workspaceRoot,
    artifactToolsRoot: asserted,
  });
}
