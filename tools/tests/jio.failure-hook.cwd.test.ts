#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { defineToolSpec } from "../jio/spec";
import { runInTemp } from "./lib/test-helpers";

describe("jio failure hook runs in resolved working directory", () => {
  test("onValidationFailure CWD == spec directory when inheritCallerCwd=false", async () => {
    await runInTemp("jio-hook-cwd", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );

      const sub = path.join(tmp, "s");
      await fsp.mkdir(sub, { recursive: true });

      // Tool emits invalid JSON to trigger validation failure
      const toolPath = path.join(tmp, "tools", "badjson.ts");
      await fsp.mkdir(path.dirname(toolPath), { recursive: true });
      await fsp.writeFile(
        toolPath,
        `#!/usr/bin/env zx-wrapper
console.log('{"bad":true}');
`,
        "utf8",
      );
      await $`chmod +x ${toolPath}`;

      const marker = path.join(sub, "cwd.txt");
      const specPath = path.join(sub, "hookcwd.tool.json");
      const spec = defineToolSpec({
        tool: {
          name: "hookcwd",
          outputSchema: {
            type: "object",
            properties: { ok: { type: "number" } },
            required: ["ok"],
          },
        },
        command: {
          package: "io.example",
          exec: toolPath,
          parameters: {},
          stdoutTransform: { shell: "jq -c .", format: "json" },
          onValidationFailure: { shell: `pwd > ${marker}` },
          inheritCallerCwd: false,
        },
      });
      await fsp.writeFile(specPath, JSON.stringify(spec, null, 2), "utf8");

      let failed = false;
      try {
        await $({ stdio: "pipe" })`jio io.example.hookcwd`;
      } catch {
        failed = true;
      }
      if (!failed) {
        console.error("expected non-zero exit due to invalid output");
        process.exit(2);
      }
      const cwdTxt = (await fsp.readFile(marker, "utf8")).trim();
      const variants = [sub];
      if (sub.startsWith("/var/")) variants.push("/private" + sub);
      if (sub.startsWith("/private/var/")) variants.push(sub.replace(/^\/private/, ""));
      if (!variants.includes(cwdTxt)) {
        console.error(`expected sink CWD to be one of ${variants.join(", ")}, got ${cwdTxt}`);
        process.exit(2);
      }
    });
  });
});
