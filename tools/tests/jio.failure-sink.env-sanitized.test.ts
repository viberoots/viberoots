#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { defineToolSpec } from "../jio/spec";
import { runInTemp } from "./lib/test-helpers";

describe("failure sink uses sanitized env like exec", () => {
  test("sink does not see parent secret unless explicitly passed", async () => {
    await runInTemp("jio-sink-env-sanitized", async (tmp, $) => {
      // Write .jio
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );

      // Create a sink script that writes env to a file
      const outFile = path.join(tmp, "sink.env.txt");
      const sinkScript = `#!/usr/bin/env bash\nset -euo pipefail\nprintenv | sort > ${outFile}\n`;

      // Tool that triggers an output validation error (to invoke sink)
      const toolScript = path.join(tmp, "tools", "bad-json.sh");
      await fsp.mkdir(path.dirname(toolScript), { recursive: true });
      await fsp.writeFile(
        toolScript,
        '#!/usr/bin/env bash\nset -euo pipefail\nprintf "%s\n" "not-json"\n',
        "utf8",
      );
      await $`chmod +x ${toolScript}`;

      const spec = defineToolSpec({
        tool: { name: "bad" },
        command: {
          package: "io.example",
          exec: toolScript,
          parameters: {},
          stdoutTransform: { shell: "cat", format: "json" },
          onValidationFailure: { shell: sinkScript },
        },
      });
      await fsp.writeFile(path.join(tmp, "bad.tool.json"), JSON.stringify(spec, null, 2), "utf8");

      // Run with a secret var in parent; we do not pass it explicitly
      try {
        await $({
          stdio: "pipe",
          env: { ...process.env, SECRET_FROM_PARENT: "shh", JIO_SKIP_DIRENV: "1" },
        })`jio io.example.bad`;
      } catch {
        // expected non-zero due to invalid JSON; continue to check sink output
      }

      // Wait briefly for sink to flush and file to appear
      const waitUntil = Date.now() + 5000;
      let txt = "";
      while (Date.now() < waitUntil) {
        try {
          const s = await fsp.stat(outFile);
          if (s.size > 0) {
            txt = await fsp.readFile(outFile, "utf8");
            break;
          }
        } catch {}
        await new Promise((r) => setTimeout(r, 50));
      }
      if (/^SECRET_FROM_PARENT=/m.test(txt)) {
        console.error("sink inherited parent SECRET_FROM_PARENT unexpectedly:\n" + txt);
        process.exit(2);
      }
    });
  });
});
