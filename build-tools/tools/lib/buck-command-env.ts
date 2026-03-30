import process from "node:process";

export function isBuckDaemonInitTransient(errText: string): boolean {
  const msg = String(errText || "");
  return (
    msg.includes("Error initializing DaemonStateData") ||
    msg.includes("Error creating HTTP client") ||
    msg.includes("Error loading system root certificates native frameworks") ||
    msg.includes("No buckd.info timed out after")
  );
}

export function buckCommandEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    IN_NIX_SHELL: process.env.IN_NIX_SHELL || "1",
    HOME: process.env.BUCK2_REAL_HOME || process.env.HOME,
    SSL_CERT_FILE: process.env.SSL_CERT_FILE || process.env.NIX_SSL_CERT_FILE,
  };
}
