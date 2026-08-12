import { isCanonicalSha256SRI } from "../lib/nix-sri";
import { runCommand } from "./filtered-flake-command";

export async function immutableStorePathNarHash(
  nixBin: string,
  immutable: string,
  nixEnv: NodeJS.ProcessEnv,
): Promise<string> {
  const info = await runCommand({
    command: nixBin,
    args: ["path-info", "--json", immutable],
    env: nixEnv,
    allowFailure: true,
  });
  if (info.exitCode !== 0) {
    throw new Error(
      `[filtered-flake] failed to inspect immutable viberoots input: ${String(info.stderr || "").trim()}`,
    );
  }
  let parsedInfo: unknown;
  try {
    parsedInfo = JSON.parse(String(info.stdout || "[]"));
  } catch {
    throw new Error("[filtered-flake] immutable viberoots path-info returned invalid JSON");
  }
  const entry = Array.isArray(parsedInfo)
    ? parsedInfo[0]
    : isRecord(parsedInfo)
      ? parsedInfo[immutable]
      : null;
  const pathInfoNarHash = isRecord(entry) && typeof entry.narHash === "string" ? entry.narHash : "";
  if (isCanonicalSha256SRI(pathInfoNarHash)) return pathInfoNarHash;

  const hashed = await runCommand({
    command: nixBin,
    args: ["hash", "path", "--sri", immutable],
    env: nixEnv,
    allowFailure: true,
  });
  const hashNarHash = String(hashed.stdout || "").trim();
  if (hashed.exitCode === 0 && isCanonicalSha256SRI(hashNarHash)) return hashNarHash;
  const infoSummary = JSON.stringify(parsedInfo).slice(0, 800);
  throw new Error(
    [
      "[filtered-flake] immutable viberoots path-info did not return a locked narHash",
      `path=${immutable}`,
      `pathInfoNarHash=${pathInfoNarHash || "<missing>"}`,
      `pathInfo=${infoSummary}`,
      `hashExit=${hashed.exitCode}`,
      `hashStdout=${hashNarHash || "<empty>"}`,
      `hashStderr=${String(hashed.stderr || "").trim() || "<empty>"}`,
    ].join("\n"),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
