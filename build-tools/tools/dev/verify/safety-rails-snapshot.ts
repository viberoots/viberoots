import "zx/globals";
import * as fsp from "node:fs/promises";
import path from "node:path";

export type VerifySafetyRailsSnapshotDeps = {
  sampleDfText: () => Promise<string>;
};

async function appendLine(p: string, line: string): Promise<void> {
  await fsp.appendFile(p, line.endsWith("\n") ? line : line + "\n", "utf8").catch(() => {});
}

export async function writeVerifySafetyRailsTriggerSnapshot(
  dir: string,
  reason: string,
  deps?: Partial<VerifySafetyRailsSnapshotDeps>,
): Promise<void> {
  const out = path.join(dir, "trigger-snapshot.txt");
  await appendLine(out, `[verify] safety-rails trigger: ${reason}\n`);
  const sampleDfText =
    deps?.sampleDfText ??
    (async () => {
      try {
        const res = await $({ stdio: "pipe", reject: false })`df -Pk . /nix/store`;
        return String(res.stdout || "");
      } catch {
        return "";
      }
    });
  const dfText = await sampleDfText();
  if (dfText.trim()) await appendLine(out, dfText);
}
