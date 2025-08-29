#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { jioCall } from "../dev/jio-call";
import { defineToolSpec } from "../jio/spec";
import { runInTemp } from "./lib/test-helpers";

describe("jioCall helper", () => {
  test("JSON tool returns parsed object", async () => {
    await runInTemp("jio-call-json", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      const toolPath = path.join(tmp, "tools", "echo-json.ts");
      await fsp.mkdir(path.dirname(toolPath), { recursive: true });
      await fsp.writeFile(
        toolPath,
        `#!/usr/bin/env zx-wrapper
console.log('{"ok":1}');
`,
        "utf8",
      );
      await $`chmod +x ${toolPath}`;
      const specPath = path.join(tmp, "echo.tool.json");
      const spec = defineToolSpec({
        tool: {
          name: "echo",
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
        },
      });
      await fsp.writeFile(specPath, JSON.stringify(spec, null, 2), "utf8");

      const out = (await jioCall(
        "io.example.echo",
        { any: true },
        { output: "json", cwd: tmp },
      )) as any;
      if (out.ok !== 1) {
        console.error("expected ok=1, got:", out);
        process.exit(2);
      }
    });
  });

  test("NDJSON tool returns collected array", async () => {
    await runInTemp("jio-call-ndjson", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      const toolPath = path.join(tmp, "tools", "echo-lines.ts");
      await fsp.mkdir(path.dirname(toolPath), { recursive: true });
      await fsp.writeFile(
        toolPath,
        `#!/usr/bin/env zx-wrapper
console.log('{"x":1}');
console.log('{"x":2}');
`,
        "utf8",
      );
      await $`chmod +x ${toolPath}`;
      const specPath = path.join(tmp, "lines.tool.json");
      const spec = defineToolSpec({
        tool: { name: "lines", outputSchema: { type: "object" } },
        command: {
          package: "io.example",
          exec: toolPath,
          parameters: {},
          stdoutTransform: { shell: "cat", format: "ndjson" },
        },
      });
      await fsp.writeFile(specPath, JSON.stringify(spec, null, 2), "utf8");

      const arr = (await jioCall("io.example.lines", {}, { output: "ndjson", cwd: tmp })) as any[];
      if (!Array.isArray(arr) || arr.length !== 2 || arr[0].x !== 1 || arr[1].x !== 2) {
        console.error("expected [ {x:1}, {x:2} ], got:", arr);
        process.exit(2);
      }
    });
  });

  test("passEnv passes selected vars", async () => {
    await runInTemp("jio-call-passenv", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      const toolPath = path.join(tmp, "tools", "printenv.ts");
      await fsp.mkdir(path.dirname(toolPath), { recursive: true });
      await fsp.writeFile(
        toolPath,
        `#!/usr/bin/env zx-wrapper
console.log(JSON.stringify({ foo: process.env.FOO || "" }));
`,
        "utf8",
      );
      await $`chmod +x ${toolPath}`;
      const specPath = path.join(tmp, "penv.tool.json");
      const spec = defineToolSpec({
        tool: { name: "penv", outputSchema: { type: "object" } },
        command: {
          package: "io.example",
          exec: toolPath,
          parameters: {},
          stdoutTransform: { shell: "jq -c .", format: "json" },
        },
      });
      await fsp.writeFile(specPath, JSON.stringify(spec, null, 2), "utf8");

      const out1 = (await jioCall(
        "io.example.penv",
        {},
        { output: "json", env: { FOO: "BAR" }, passEnv: [], cwd: tmp },
      )) as any;
      if (out1.foo !== "") {
        console.error("expected empty foo without passEnv, got:", out1);
        process.exit(2);
      }
      const out2 = (await jioCall(
        "io.example.penv",
        {},
        { output: "json", env: { FOO: "BAR" }, passEnv: ["FOO"], cwd: tmp },
      )) as any;
      if (out2.foo !== "BAR") {
        console.error("expected foo=BAR with passEnv=FOO, got:", out2);
        process.exit(2);
      }
    });
  });

  test("error path surfaces stderr", async () => {
    await runInTemp("jio-call-error", async (_tmp, _$) => {
      let failed = false;
      try {
        await jioCall("io.example.missing", {}, { output: "json" });
      } catch (e: any) {
        const msg = String(e?.message || e || "");
        if (!/tool not found/i.test(msg)) {
          console.error("expected not-found error surfaced, got:", msg);
          process.exit(2);
        }
        failed = true;
      }
      if (!failed) {
        console.error("expected failure for missing tool");
        process.exit(2);
      }
    });
  });
});
