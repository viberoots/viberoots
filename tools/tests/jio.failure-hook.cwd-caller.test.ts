#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { defineToolSpec } from "../jio/spec";
import { runInTemp } from "./lib/test-helpers";

describe("jio failure hook runs in caller CWD when inheritCallerCwd=true", () => {
  test("onValidationFailure CWD == caller CWD", async () => {
    await runInTemp("jio-hook-caller", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );

      const sub = path.join(tmp, "s");
      await fsp.mkdir(sub, { recursive: true });

      const toolPath = path.join(tmp, "tools", "badjson.ts");
      await fsp.mkdir(path.dirname(toolPath), { recursive: true });
      await fsp.writeFile(
        toolPath,
        `#!/usr/bin/env zx-wrapper
console.log('{"notOk":true}');
`,
        "utf8",
      );
      await $`chmod +x ${toolPath}`;

      const marker = path.join(tmp, "sink.txt");
      const specPath = path.join(sub, "hookcaller.tool.json");
      const spec = defineToolSpec({
        tool: {
          name: "hookcaller",
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
          inheritCallerCwd: true,
        },
      });
      await fsp.writeFile(specPath, JSON.stringify(spec, null, 2), "utf8");

      // Run from repo root, not spec directory
      let failed = false;
      try {
        await $({ stdio: "pipe" })`jio io.example.hookcaller`;
      } catch {
        failed = true;
      }
      if (!failed) {
        console.error("expected non-zero exit due to invalid output");
        process.exit(2);
      }
      const cwdTxt = (await fsp.readFile(marker, "utf8")).trim();
      const variants = [tmp];
      if (tmp.startsWith("/var/")) variants.push("/private" + tmp);
      if (tmp.startsWith("/private/var/")) variants.push(tmp.replace(/^\/private/, ""));
      if (!variants.includes(cwdTxt)) {
        console.error(`expected sink CWD to be one of ${variants.join(", ")}, got ${cwdTxt}`);
        process.exit(2);
      }
    });
  });
});
