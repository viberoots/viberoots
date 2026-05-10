import crypto from "node:crypto";
import path from "node:path";
import process from "node:process";

export function workspaceRootForBuckEnv(env: NodeJS.ProcessEnv = process.env): string {
  return String(env.BUCK_TEST_SRC || env.WORKSPACE_ROOT || process.cwd()).trim() || process.cwd();
}

export function stableBuckIsolation(root: string, prefix = "buck-shared"): string {
  const resolvedRoot = path.resolve(root || process.cwd());
  const hash = crypto.createHash("sha256").update(resolvedRoot).digest("hex").slice(0, 10);
  return `${prefix}-${hash}`;
}

export function resolveNestedBuckIsolation(opts?: {
  env?: NodeJS.ProcessEnv;
  root?: string;
  prefix?: string;
}): {
  isolationDir: string;
  ownsIsolation: boolean;
} {
  const env = opts?.env || process.env;
  const inherited = String(env.BUCK_ISOLATION_DIR || env.BUCK_NESTED_ISO || "").trim();
  if (inherited) return { isolationDir: inherited, ownsIsolation: false };
  const root = String(opts?.root || workspaceRootForBuckEnv(env)).trim() || process.cwd();
  return {
    isolationDir: stableBuckIsolation(root, opts?.prefix || "buck-shared"),
    ownsIsolation: true,
  };
}

export function isBuckDaemonInitTransient(errText: string): boolean {
  const msg = String(errText || "");
  return (
    msg.includes("Error initializing DaemonStateData") ||
    msg.includes("Error creating HTTP client") ||
    msg.includes("Could not connect to buck2 daemon") ||
    msg.includes("Failed to connect to buck daemon") ||
    msg.includes("Error loading system root certificates native frameworks") ||
    msg.includes("No buckd.info timed out after")
  );
}

export function buckCommandEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    IN_NIX_SHELL: process.env.IN_NIX_SHELL || "1",
    HOME: process.env.BUCK2_REAL_HOME || process.env.HOME,
    SSL_CERT_FILE: process.env.SSL_CERT_FILE || process.env.NIX_SSL_CERT_FILE,
  };
  if (!env.BUCK_NESTED_ISO) {
    env.BUCK_NESTED_ISO = stableBuckIsolation(workspaceRootForBuckEnv(env), "buck-shared");
  }
  if (!env.BUCK_EXPORTER_REUSE_DAEMON) {
    env.BUCK_EXPORTER_REUSE_DAEMON = "1";
  }
  env.BUCKD_STARTUP_TIMEOUT = env.BUCKD_STARTUP_TIMEOUT || "300";
  env.BUCKD_STARTUP_INIT_TIMEOUT = env.BUCKD_STARTUP_INIT_TIMEOUT || env.BUCKD_STARTUP_TIMEOUT;
  return env;
}
