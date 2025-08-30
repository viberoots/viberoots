#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { defineToolSpec } from "../jio/spec";
import { runInTemp } from "./lib/test-helpers";

describe("jio detects secretspec on PATH and auto-wraps exec", () => {
  test("auto-wrap uses secretspec when present on PATH (pre-fix should fail)", async () => {
    await runInTemp("jio-secretspec-path-detect", async (tmp, $) => {
      // Create a fake secretspec on PATH that records invocation and then execs the underlying command
      const binDir = path.join(tmp, "bin");
      await fsp.mkdir(binDir, { recursive: true });
      const marker = path.join(tmp, "secretspec.invoked");
      const fake = path.join(binDir, "secretspec");
      await fsp.writeFile(
        fake,
        `#!/usr/bin/env bash\nset -euo pipefail\nif [[ -n \"\${MARKER_PATH:-}\" ]]; then echo wrapped > \"\${MARKER_PATH}\"; fi\n# shift until -- then exec remaining\nwhile [[ $# -gt 0 ]]; do\n  if [[ \"$1\" == \"--\" ]]; then shift; break; fi\n  shift\ndone\nexec "$@"\n`,
        "utf8",
      );
      await $`chmod +x ${fake}`;

      // Minimal .jio and secretspec.toml to trigger auto-wrap
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      await fsp.writeFile(
        path.join(tmp, "secretspec.toml"),
        '[project]\nname="demo"\nrevision="1.0"\n',
        "utf8",
      );

      // Tool that prints a literal line (to be transformed to NDJSON)
      const toolScript = path.join(tmp, "tools", "echo.sh");
      await fsp.mkdir(path.dirname(toolScript), { recursive: true });
      await fsp.writeFile(
        toolScript,
        '#!/usr/bin/env bash\nset -euo pipefail\nprintf "%s\\n" ok\n',
        "utf8",
      );
      await $`chmod +x ${toolScript}`;

      const spec = defineToolSpec({
        tool: { name: "echo" },
        command: {
          package: "io.example",
          exec: toolScript,
          parameters: {},
          stdoutTransform: { shell: "jq -R -c .", format: "ndjson" },
        },
      });
      await fsp.writeFile(path.join(tmp, "echo.tool.json"), JSON.stringify(spec, null, 2), "utf8");

      // Prepend fake secretspec to PATH and run jio
      const newPath = `${binDir}:${process.env.PATH || ""}`;
      const res = await $({
        stdio: "pipe",
        env: { ...process.env, PATH: newPath, MARKER_PATH: marker, JIO_SKIP_DIRENV: "1" },
      })`jio --pass-env MARKER_PATH io.example.echo`;
      const line = String(res.stdout || "").trim();
      const got = line ? JSON.parse(line) : "";
      if (got !== "ok") {
        console.error("unexpected output:", line);
        process.exit(2);
      }
      // Expect secretspec was invoked and wrote the marker
      try {
        const txt = await fsp.readFile(marker, "utf8");
        if (!/^wrapped\s*$/.test(txt)) {
          console.error("marker content mismatch:", txt);
          process.exit(2);
        }
      } catch (e) {
        console.error("expected secretspec auto-wrap to write marker but file missing", e);
        process.exit(2);
      }
    });
  });
});
