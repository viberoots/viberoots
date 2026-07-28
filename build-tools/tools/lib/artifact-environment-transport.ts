import fs from "node:fs";
import path from "node:path";

export const ARTIFACT_TRANSPORT_ENV = new Set([
  "BUCKD_STARTUP_INIT_TIMEOUT",
  "BUCKD_STARTUP_TIMEOUT",
  "BUCK_ISOLATION_DIR",
  "BUCK_NESTED_ISO",
  "CI",
  "DEV_BUILD_LOW_SPACE_GB",
  "IN_NIX_SHELL",
  "NIX_BUILD_CORES",
  "TERM",
  "VBR_ARTIFACT_JOB",
  "VBR_ARTIFACT_TOOLS_ROOT",
  "VBR_GC_MODE",
  "VBR_NIX_CACHE_POLICY",
  "VBR_NIX_DIRENV_DIRENVRC",
  "VBR_VERIFY_LOCK_DIR",
  "VBR_VERIFY_PROCESS_STATE_FILE",
]);

export function artifactTransportEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  assertBuildConcurrency(env);
  const nixRemote = String(env.NIX_REMOTE || "").trim();
  if (nixRemote && nixRemote !== "daemon") {
    throw new Error(`artifact transport rejects ambient NIX_REMOTE authority: ${nixRemote}`);
  }
  return Object.fromEntries(
    Object.entries(env).filter(
      ([name, value]) => value !== undefined && ARTIFACT_TRANSPORT_ENV.has(name),
    ),
  );
}

export function assertCanonicalArtifactTransport(
  env: NodeJS.ProcessEnv,
  artifactToolsRoot: string,
): string {
  assertBuildConcurrency(env);
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

function assertBuildConcurrency(env: NodeJS.ProcessEnv): void {
  const cores = String(env.NIX_BUILD_CORES || "").trim();
  if (cores && !/^[1-9][0-9]*$/u.test(cores)) {
    throw new Error(`artifact transport rejects invalid NIX_BUILD_CORES: ${cores}`);
  }
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
