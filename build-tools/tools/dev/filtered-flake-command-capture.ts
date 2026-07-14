import * as fsp from "node:fs/promises";
import path from "node:path";
import { mkdtempNoindex } from "../lib/macos-metadata";
import {
  removeOwnedTempTree,
  rethrowAfterOwnedTempCleanup,
  runOwnedTempCleanup,
} from "../lib/owned-temp-cleanup";

export type CommandCapture = {
  stdio: ["ignore", "pipe" | number, "pipe" | number];
  read: () => Promise<{ stdout: string; stderr: string }>;
  cleanup: () => Promise<void>;
  cleanupPath?: string;
};

export async function commandCapture(): Promise<CommandCapture> {
  if (process.platform !== "darwin") {
    return {
      stdio: ["ignore", "pipe", "pipe"],
      read: async () => ({ stdout: "", stderr: "" }),
      cleanup: async () => {},
    };
  }

  const dir = await mkdtempNoindex("vbr-command-", { baseName: "viberoots-command" });
  const stdoutPath = path.join(dir, "stdout");
  const stderrPath = path.join(dir, "stderr");
  const stdoutHandle = await fsp.open(stdoutPath, "w+");
  const stderrHandle = await fsp.open(stderrPath, "w+").catch(async (error) => {
    await rethrowAfterOwnedTempCleanup(error, [
      async () => await stdoutHandle.close(),
      async () => await removeOwnedTempTree(dir),
    ]);
  });
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await Promise.all([stdoutHandle.close(), stderrHandle.close()]);
  };
  return {
    stdio: ["ignore", stdoutHandle.fd, stderrHandle.fd],
    read: async () => {
      await close();
      const [stdout, stderr] = await Promise.all([
        fsp.readFile(stdoutPath, "utf8"),
        fsp.readFile(stderrPath, "utf8"),
      ]);
      return { stdout, stderr };
    },
    cleanup: async () => {
      await runOwnedTempCleanup([
        async () => await close(),
        async () => await removeOwnedTempTree(dir),
      ]);
    },
    cleanupPath: dir,
  };
}
