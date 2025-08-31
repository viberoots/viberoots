#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { runInTemp } from "./lib/test-helpers";

describe("jio terminates long-lived background child on timeout", () => {
  test(
    "timeout kills background child (assert via terminate event)",
    { skip: process.platform === "darwin" },
    async () => {
      await runInTemp("jio-child-timeout", async (tmp, $) => {
        await fsp.writeFile(
          path.join(tmp, ".jio"),
          JSON.stringify({ defaultPackage: "io.example" }),
          "utf8",
        );
        const pidFile = path.join(tmp, "child.pid");
        const tool = path.join(tmp, "tools", "child-timeout.sh");
        await fsp.mkdir(path.dirname(tool), { recursive: true });
        await fsp.writeFile(
          tool,
          `#!/usr/bin/env bash\nset -euo pipefail\n( sh -c 'echo $$ > "${pidFile}"; while true; do sleep 1; done' ) &\n# stay alive until killed by jio timeout\nsleep 3600\n`,
          "utf8",
        );
        await $`chmod +x ${tool}`;
        const spec = {
          tool: { name: "childtimeout" },
          command: { package: "io.example", exec: tool, timeoutMs: 500, parameters: {} },
        };
        const specPath = path.join(tmp, "io.example.childtimeout.tool.json");
        await fsp.writeFile(specPath, JSON.stringify(spec), "utf8");

        let failed = false;
        let errStderr = "";
        try {
          await $({
            cwd: tmp,
            stdio: "pipe",
            env: { ...process.env, TEST_CAPTURE_LOGS: "1" },
          })`jio io.example.childtimeout`;
        } catch (e: any) {
          failed = true;
          errStderr = String(e?.stderr || e?.stdout || "");
        }
        if (!failed) {
          console.error("expected timeout");
          process.exit(2);
        }

        // Wait briefly for pid file to be written by the child
        const waitPidUntil = Date.now() + 2000;
        let pidTxt = await fsp.readFile(pidFile, "utf8").catch(() => "");
        while (!pidTxt && Date.now() < waitPidUntil) {
          await new Promise((r) => setTimeout(r, 50));
          pidTxt = await fsp.readFile(pidFile, "utf8").catch(() => "");
        }
        const pid = Number((pidTxt || "0").trim());

        // Validate terminate event includes the child PID
        const lines = errStderr.split(/\r?\n/).filter(Boolean);
        const evts: any[] = [];
        for (const ln of lines) {
          try {
            const o = JSON.parse(ln);
            if (o && o.event) evts.push(o);
          } catch {}
        }
        const term = evts.find((e) => e.event === "terminate" && Array.isArray(e.pids));
        if (!term || !term.pids.includes(pid)) {
          console.error("missing terminate event or child pid not listed", { pid, term });
          process.exit(2);
        }
      });
    },
  );
});
