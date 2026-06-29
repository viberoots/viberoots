import * as fsp from "node:fs/promises";
import process from "node:process";
import { isVbrVerbose } from "../../lib/command-ui";
import type { Buck2Completion } from "./buck2-output";

export function createBuck2SlowestRecorder(max: number) {
  const slowest: Buck2Completion[] = [];
  let count = 0;

  return {
    count: () => count,
    record: (completion: Buck2Completion) => {
      count++;
      slowest.push(completion);
      slowest.sort((a, b) => b.durationSec - a.durationSec);
      if (slowest.length > max) slowest.length = max;
    },
    write: async (logFile: string | null, passName: string) => {
      if (!logFile || slowest.length === 0) return;
      const header = `[verify] slowest targets pass=${passName} (top ${Math.min(max, slowest.length)}):`;
      const lines = slowest.map((c) => {
        const secs = c.durationSec.toFixed(1);
        return `[verify] slow ${secs}s ${c.status} ${c.target} (${c.rawDuration})`;
      });
      try {
        if (isVbrVerbose()) {
          process.stderr.write(header + "\n");
          for (const line of lines) process.stderr.write(line + "\n");
        }
      } catch {}
      await fsp.appendFile(logFile, [header, ...lines, ""].join("\n"), "utf8").catch(() => {});
    },
  };
}
