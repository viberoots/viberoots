#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { jioCall } from "../dev/jio-call";
import { defineToolSpec } from "../jio/spec";
import { runInTemp } from "./lib/test-helpers";

describe("jioCall helper — passEnv", () => {
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
});
