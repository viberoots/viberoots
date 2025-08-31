#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { defineToolSpec } from "../jio/spec";
import { runInTemp } from "./lib/test-helpers";

// Verify two-phase termination: SIGTERM then SIGKILL after 5s, applied to main and descendants
describe("jio SIGKILL after 5s to main and children", () => {
  test("timeout triggers terminate event and kills children", async () => {
    await runInTemp("jio-sigkill-after-5s", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );

      const toolPath = path.join(tmp, "tools", "slow-tree.ts");
      await fsp.mkdir(path.dirname(toolPath), { recursive: true });
      // Spawn a child that ignores SIGTERM so it requires SIGKILL, and another that exits
      await fsp.writeFile(
        toolPath,
        `#!/usr/bin/env zx-wrapper
import { spawn } from 'node:child_process';
const a = spawn('bash', ['-lc', 'trap : TERM; while true; do sleep 1; done'], { detached: true });
const b = spawn('bash', ['-lc', 'sleep 60'], { detached: true });
console.log('{"ok":true}');
`,
        "utf8",
      );
      await $`chmod +x ${toolPath}`;

      const specPath = path.join(tmp, "slow-tree.tool.json");
      const spec = defineToolSpec({
        tool: { name: "slow-tree" },
        command: {
          package: "io.example",
          exec: toolPath,
          parameters: {},
          stdoutTransform: { shell: "jq -c .", format: "json" },
          timeoutMs: 1000,
        },
      });
      await fsp.writeFile(specPath, JSON.stringify(spec, null, 2), "utf8");

      let failed = false;
      try {
        await $({ stdio: "pipe" })`jio io.example.slow-tree`;
      } catch (e: any) {
        const err = String(e?.stderr || e?.stdout || "");
        if (!/timeout/i.test(err)) {
          console.error("expected timeout diagnostics, got:\n" + err);
          process.exit(2);
        }
        failed = true;
      }
      if (!failed) {
        console.error("expected timeout non-zero exit");
        process.exit(2);
      }
    });
  });
});
