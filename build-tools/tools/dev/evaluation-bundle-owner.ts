import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { removeOwnedTempTree } from "../lib/owned-temp-cleanup";
import { watchdogEnvFor } from "../lib/managed-command-watchdog";
import { ensureNixStoreToolPathSync } from "../lib/tool-paths";

const markerName = ".viberoots-evaluation-bundle-owner";
const processGroupName = ".viberoots-evaluation-bundle-process-group";

export async function claimBundleTempRoot(
  root: string,
  artifactEnv: NodeJS.ProcessEnv,
): Promise<{
  cleanup: () => Promise<void>;
  recordProcessGroup: (processGroupId: number) => void;
}> {
  const marker = path.join(root, markerName);
  const processGroup = path.join(root, processGroupName);
  const identity = `${process.pid}:${randomUUID()}`;
  await fsp.writeFile(marker, `${identity}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  await fsp.writeFile(processGroup, "0\n", { encoding: "utf8", flag: "wx", mode: 0o600 });
  const script = [
    "set -u",
    'P="$1"',
    'R="$2"',
    'M="$3"',
    'I="$4"',
    'GFILE="$5"',
    'while kill -0 "$P" 2>/dev/null; do',
    "  if IFS= read -r -t 1 _ <&3; then exit 0; fi",
    "done",
    'G="$(cat "$GFILE" 2>/dev/null || printf 0)"',
    'case "$G" in (*[!0-9]*|"") G=0;; esac',
    "ALIVE=0",
    'if [ "$G" -gt 0 ] && kill -0 -- "-$G" 2>/dev/null; then',
    '  kill -TERM -- "-$G" 2>/dev/null || true',
    '  N=0; while kill -0 -- "-$G" 2>/dev/null && [ "$N" -lt 40 ]; do sleep 0.25; N=$((N+1)); done',
    '  kill -KILL -- "-$G" 2>/dev/null || true',
    '  N=0; while kill -0 -- "-$G" 2>/dev/null && [ "$N" -lt 8 ]; do sleep 0.25; N=$((N+1)); done',
    '  if kill -0 -- "-$G" 2>/dev/null; then ALIVE=1; fi',
    "fi",
    'if [ "$ALIVE" -eq 0 ] && [ "$(cat "$M" 2>/dev/null || true)" = "$I" ]; then',
    '  rm -rf -- "$R"',
    "fi",
  ].join("\n");
  const watchdog = spawn(
    ensureNixStoreToolPathSync("bash", artifactEnv),
    [
      "--noprofile",
      "--norc",
      "-c",
      script,
      "evaluation-bundle-watchdog",
      String(process.pid),
      root,
      marker,
      identity,
      processGroup,
    ],
    {
      env: watchdogEnvFor(artifactEnv),
      stdio: ["ignore", "ignore", "ignore", "pipe"],
      detached: true,
    },
  );
  await new Promise<void>((resolve, reject) => {
    watchdog.once("spawn", resolve);
    watchdog.once("error", reject);
  }).catch(async (error) => {
    await removeOwnedTempTree(root);
    throw error;
  });
  const control = watchdog.stdio[3] as NodeJS.WritableStream | null;
  control?.on("error", () => {});
  watchdog.on("error", () => {});
  watchdog.unref();
  let stopped = false;
  const stopWatchdog = async () => {
    if (stopped) return;
    stopped = true;
    control?.end("stop\n");
    if (watchdog.exitCode == null) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`evaluation bundle watchdog did not stop: ${root}`)),
          2_000,
        );
        watchdog.once("close", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  };
  const cleanup = async () => {
    await stopWatchdog();
    const current = await fsp.readFile(marker, "utf8").catch(() => "");
    if (current !== `${identity}\n`) {
      throw new Error(`evaluation bundle cleanup ownership is ambiguous: ${root}`);
    }
    await removeOwnedTempTree(root);
  };
  return {
    cleanup,
    recordProcessGroup: (processGroupId: number) => {
      if (!Number.isInteger(processGroupId) || processGroupId <= 0) {
        throw new Error(`invalid evaluation bundle process group: ${processGroupId}`);
      }
      fs.writeFileSync(processGroup, `${processGroupId}\n`, { mode: 0o600 });
    },
  };
}
