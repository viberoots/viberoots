import path from "node:path";
import fs from "node:fs";
import {
  ARTIFACT_SELECTORS,
  assertNoArtifactSelectorInjection,
  isArtifactAffectingEnvName,
  withoutArtifactEnvironmentInfluence,
} from "./artifact-environment-policy";
import { canonicalArtifactToolsRoot, validateArtifactToolsRoot } from "./artifact-tool-authority";

export {
  artifactSelectorNames,
  assertNoArtifactSelectorInjection,
  isArtifactAffectingEnvName,
  withoutArtifactEnvironmentInfluence,
} from "./artifact-environment-policy";
export {
  canonicalArtifactToolsRoot,
  REQUIRED_ARTIFACT_TOOL_BINARIES,
  validateArtifactToolsRoot,
} from "./artifact-tool-authority";

export type ArtifactEnvironmentMode = "local" | "ci" | "remote";

const TRANSPORT_ENV = new Set([
  "BUCKD_STARTUP_INIT_TIMEOUT",
  "BUCKD_STARTUP_TIMEOUT",
  "BUCK_ISOLATION_DIR",
  "BUCK_NESTED_ISO",
  "CI",
  "DEV_BUILD_LOW_SPACE_GB",
  "IN_NIX_SHELL",
  "TERM",
  "VBR_ARTIFACT_JOB",
  // Reviewed tool-authority marker: when the parent shell has already validated
  // the canonical /nix/store tool closure, propagate the marker so child
  // processes running in filtered/temp workspaces (without toolchain-paths.json)
  // can locate the authority.
  "VBR_ARTIFACT_TOOLS_ROOT",
  "VBR_GC_MODE",
  "VBR_VERIFY_LOCK_DIR",
  "VBR_VERIFY_PROCESS_STATE_FILE",
]);

const CANONICAL_ARTIFACT_ENV_KEYS = new Set([
  "HOME",
  "LANG",
  "LC_ALL",
  "NIX_REMOTE",
  "NIX_SSL_CERT_FILE",
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

export function artifactTransportEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const nixRemote = String(env.NIX_REMOTE || "").trim();
  if (nixRemote && nixRemote !== "daemon") {
    throw new Error(`artifact transport rejects ambient NIX_REMOTE authority: ${nixRemote}`);
  }
  return Object.fromEntries(
    Object.entries(env).filter(([name, value]) => value !== undefined && TRANSPORT_ENV.has(name)),
  );
}

function canonicalArtifactCertificateFile(artifactToolsRoot: string): {
  path: string;
  realPath: string;
} {
  const certPath = path.join(artifactToolsRoot, "etc", "ssl", "certs", "ca-bundle.crt");
  try {
    const realPath = fs.realpathSync(certPath);
    if (!fs.statSync(realPath).isFile()) throw new Error("certificate authority is not a file");
    return { path: certPath, realPath };
  } catch (error) {
    throw new Error(`canonical artifact tool authority is missing its CA bundle: ${certPath}`, {
      cause: error,
    });
  }
}

function assertCanonicalArtifactTransport(
  env: NodeJS.ProcessEnv,
  artifactToolsRoot: string,
): string {
  const nixRemote = String(env.NIX_REMOTE || "").trim();
  if (nixRemote && nixRemote !== "daemon") {
    throw new Error(`artifact build rejects ambient NIX_REMOTE authority: ${nixRemote}`);
  }
  const cert = canonicalArtifactCertificateFile(artifactToolsRoot);
  for (const name of ["NIX_SSL_CERT_FILE", "SSL_CERT_FILE"] as const) {
    const supplied = String(env[name] || "").trim();
    if (!supplied) continue;
    let suppliedReal: string;
    try {
      suppliedReal = fs.realpathSync(supplied);
    } catch (error) {
      throw new Error(`artifact build rejects unavailable ${name}: ${supplied}`, { cause: error });
    }
    if (suppliedReal !== cert.realPath) {
      throw new Error(`artifact build rejects unreviewed ${name}: ${supplied}`);
    }
  }
  return cert.path;
}

export function buildArtifactEnvironment(opts: {
  baseEnv: NodeJS.ProcessEnv;
  mode: ArtifactEnvironmentMode;
  stateRoot: string;
  workspaceRoot: string;
  artifactToolsRoot?: string;
  internal?: NodeJS.ProcessEnv;
}): NodeJS.ProcessEnv {
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
      ...TRANSPORT_ENV,
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
    NIX_SSL_CERT_FILE: artifactCertificateFile,
    SSL_CERT_FILE: artifactCertificateFile,
  };
  for (const [name, value] of Object.entries(opts.baseEnv)) {
    if (value === undefined) continue;
    if (TRANSPORT_ENV.has(name)) {
      out[name] = value;
    }
  }
  for (const [name, value] of Object.entries(opts.internal || {})) {
    if (value !== undefined) out[name] = value;
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
