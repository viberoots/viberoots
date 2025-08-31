#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { runInTemp } from "./lib/test-helpers";

async function pidAliveShell($: any, pid: number): Promise<boolean> {
  const res = await $({
    stdio: "pipe",
  })`bash -lc 'kill -0 ${pid} 2>/dev/null && echo ALIVE || echo DEAD'`;
  return String(res.stdout || "").includes("ALIVE");
}

describe("jio parse-fail kills background child", () => {
  test(
    "stdin parse-fail kills background child",
    { skip: process.platform === "darwin" },
    async () => {
      await runInTemp("jio-child-parsefail", async (tmp, $) => {
        await fsp.writeFile(
          path.join(tmp, ".jio"),
          JSON.stringify({ defaultPackage: "io.example" }),
          "utf8",
        );
        const pidFile = path.join(tmp, "child2.pid");
        const tool = path.join(tmp, "tools", "child-parsefail.sh");
        await fsp.mkdir(path.dirname(tool), { recursive: true });
        await fsp.writeFile(
          tool,
          `#!/usr/bin/env bash\nset -euo pipefail\n( sh -c 'echo $$ > "${pidFile}"; while true; do sleep 1; done' ) &\n# emit lots of output until jio kills us\nwhile true; do echo ok; sleep 0.01; done\n`,
          "utf8",
        );
        await $`chmod +x ${tool}`;
        const spec = {
          tool: { name: "childparse" },
          command: {
            package: "io.example",
            exec: tool,
            stdinTransform: { shell: "cat", format: "ndjson" },
            // stdoutTransform will parse raw lines as ndjson via shell
            stdoutTransform: { shell: "cat", format: "ndjson" },
            limits: { maxNdjsonLineBytes: 64 },
            parameters: {},
          },
        };
        const specPath = path.join(tmp, "io.example.childparse.tool.json");
        await fsp.writeFile(specPath, JSON.stringify(spec), "utf8");
        // Feed an invalid NDJSON line to trigger immediate parse failure
        let failed = false;
        try {
          await $({
            cwd: tmp,
            stdio: "pipe",
          })`bash -lc ${`printf 'not-json\n' | jio io.example.childparse`}`;
        } catch {
          failed = true;
        }
        if (!failed) {
          console.error("expected parse failure");
          process.exit(2);
        }
        const waitPidUntil2 = Date.now() + 2000;
        let pidTxt = await fsp.readFile(pidFile, "utf8").catch(() => "");
        while (!pidTxt && Date.now() < waitPidUntil2) {
          await new Promise((r) => setTimeout(r, 50));
          pidTxt = await fsp.readFile(pidFile, "utf8").catch(() => "");
        }
        const pid = Number(pidTxt.trim() || "0");
        const until = Date.now() + 8000;
        let gone = false;
        while (Date.now() < until) {
          if (!(await pidAliveShell($, pid))) {
            gone = true;
            break;
          }
          await new Promise((r) => setTimeout(r, 100));
        }
        if (!gone) {
          console.error("child not terminated after parse fail", pid);
          process.exit(2);
        }
      });
    },
  );
});
