import * as fsp from "node:fs/promises";
import path from "node:path";
import { mkdtempNoindex } from "../lib/macos-metadata";
import {
  removeOwnedTempTree,
  rethrowAfterOwnedTempCleanup,
  runOwnedTempCleanup,
} from "../lib/owned-temp-cleanup";

export type CommandCapture = {
  stdio: ["ignore" | "inherit", "ignore" | "inherit" | "pipe", "ignore" | "inherit" | "pipe"];
  redirect?: (
    shell: string,
    command: string,
    args: readonly string[],
  ) => {
    command: string;
    args: string[];
  };
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
  await Promise.all([fsp.writeFile(stdoutPath, ""), fsp.writeFile(stderrPath, "")]).catch(
    async (error) => await rethrowAfterOwnedTempCleanup(error, [() => removeOwnedTempTree(dir)]),
  );
  return {
    stdio: ["inherit", "inherit", "inherit"],
    redirect: (shell, command, args) => ({
      command: shell,
      args: [
        "--noprofile",
        "--norc",
        "-c",
        'stdout="$1"; stderr="$2"; shift 2; exec "$@" </dev/null >"$stdout" 2>"$stderr"',
        "viberoots-command-capture",
        stdoutPath,
        stderrPath,
        command,
        ...args,
      ],
    }),
    read: async () => {
      const [stdout, stderr] = await Promise.all([
        fsp.readFile(stdoutPath, "utf8"),
        fsp.readFile(stderrPath, "utf8"),
      ]);
      return { stdout, stderr };
    },
    cleanup: async () => {
      await runOwnedTempCleanup([async () => await removeOwnedTempTree(dir)]);
    },
    cleanupPath: dir,
  };
}
