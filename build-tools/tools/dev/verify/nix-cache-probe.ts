import { execFile } from "node:child_process";
import fs from "node:fs";
import { promisify } from "node:util";
import { nixCacheSubstituterIdentity } from "../../lib/nix-cache-readiness";
import { withSanitizedInheritedNixConfig } from "../../lib/nix-config-env";
import { isNixCacheTransportCurlExitCode } from "../../lib/nix-cache-transport";
import { envWithResolvedNixBin } from "../../lib/tool-paths";

const execFileAsync = promisify(execFile);

export async function probeNixCacheUrl(
  url: string,
  timeoutMs: number,
  netrcFile: string,
  resolveCurlBin: (env: NodeJS.ProcessEnv) => string,
): Promise<boolean> {
  const connectTimeout = String(Math.max(1, Math.ceil(timeoutMs / 1000)));
  const commandEnv = withSanitizedInheritedNixConfig(envWithResolvedNixBin({ ...process.env }));
  const readableNetrcFile = (() => {
    if (!netrcFile) return "";
    try {
      if (!fs.statSync(netrcFile).isFile()) return "";
      fs.accessSync(netrcFile, fs.constants.R_OK);
      return netrcFile;
    } catch {
      return "";
    }
  })();
  const args = [
    "-fsS",
    "--connect-timeout",
    connectTimeout,
    "--max-time",
    connectTimeout,
    ...(readableNetrcFile ? ["--netrc-file", readableNetrcFile] : []),
    nixCacheInfoUrl(url),
  ];
  try {
    await execFileAsync(resolveCurlBin(commandEnv), args, { env: commandEnv });
    return true;
  } catch (error) {
    const code = Number((error as NodeJS.ErrnoException).code);
    if (isNixCacheTransportCurlExitCode(code)) return false;
    throw new Error(
      `Nix cache probe rejected non-transport failure for ${nixCacheSubstituterIdentity(
        url,
      )}: curl exit ${Number.isFinite(code) ? code : "unknown"}`,
    );
  }
}

function nixCacheInfoUrl(raw: string): string {
  const url = new URL(raw);
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/nix-cache-info`;
  url.hash = "";
  return url.toString();
}
