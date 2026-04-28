import * as fsp from "node:fs/promises";
import os from "node:os";
import { countIsolationMatches, sampleVerifyProcessSnapshot } from "./buck2-failure-diagnostics";

export type VerifyDaemonCheckpoints = {
  stopAndWriteExit: () => Promise<void>;
};

export function startVerifyDaemonCheckpoints(opts: {
  logFile: string | null;
  passName: string;
  startS: number;
  parentIso: string;
  nestedIso: string;
}): VerifyDaemonCheckpoints {
  let timer: NodeJS.Timeout | null = null;
  let running = false;
  let sawNestedDaemon = false;
  let lastNestedMatches: number | null = null;
  let lastSeenBuckLines: string[] = [];

  const write = async (reason: string): Promise<void> => {
    if (!opts.logFile || running) return;
    running = true;
    try {
      const snapshot = await sampleVerifyProcessSnapshot(1000);
      const elapsedS = Math.max(0, Math.floor(Date.now() / 1000) - opts.startS);
      if (!snapshot) {
        await fsp
          .appendFile(
            opts.logFile,
            `[verify] daemon checkpoint pass=${opts.passName} reason=${reason} elapsed_s=${elapsedS} snapshot=unavailable\n`,
            "utf8",
          )
          .catch(() => {});
        return;
      }

      const [load1, load5, load15] = os.loadavg();
      const { parentMatches, nestedMatches } = countIsolationMatches({
        snapshot,
        parentIso: opts.parentIso,
        nestedIso: opts.nestedIso,
      });
      if (nestedMatches > 0) sawNestedDaemon = true;
      const relevantBuckLines = snapshot.buckLines.filter(
        (line) => line.includes(opts.parentIso) || line.includes(opts.nestedIso),
      );
      if (relevantBuckLines.length > 0) lastSeenBuckLines = relevantBuckLines.slice(0, 12);
      const lostNested = sawNestedDaemon && lastNestedMatches !== 0 && nestedMatches === 0;
      lastNestedMatches = nestedMatches;

      const lines = [
        `[verify] daemon checkpoint pass=${opts.passName} reason=${reason}${lostNested ? ":lost-nested" : ""} elapsed_s=${elapsedS} parent_iso=${opts.parentIso} parent_matches=${parentMatches} nested_iso=${opts.nestedIso} nested_matches=${nestedMatches} total=${snapshot.total} buck=${snapshot.buck} node=${snapshot.node} nix=${snapshot.nix} load1=${load1.toFixed(2)} load5=${load5.toFixed(2)} load15=${load15.toFixed(2)}`,
      ];
      if (lostNested) {
        const current = relevantBuckLines.slice(0, 12);
        lines.push(...current.map((line) => `[verify] daemon checkpoint buck ${line}`));
        lines.push(
          ...lastSeenBuckLines.map((line) => `[verify] daemon checkpoint last_seen_buck ${line}`),
        );
      }
      await fsp.appendFile(opts.logFile, lines.join("\n") + "\n", "utf8").catch(() => {});
    } finally {
      running = false;
    }
  };

  if (opts.logFile) {
    void write("start");
    timer = setInterval(() => void write("interval"), 30_000);
  }

  return {
    stopAndWriteExit: async () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      await write("exit");
    },
  };
}
