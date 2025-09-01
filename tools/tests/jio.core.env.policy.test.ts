#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { buildChildEnv, readRootConfig } from "../../tools/jio/core/index.ts";
import { defineToolSpec } from "../jio/spec";
import { runInTemp } from "./lib/test-helpers";

describe("jio core — env policy", () => {
  test("clean env with passthrough and --pass-env glob", async () => {
    await runInTemp("jio-core-env", async (tmp, $) => {
      process.env.TEST_ENV_FOO = "x";
      process.env.AWS_TOKEN_ABC = "y";
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example", env: { GLOBAL_ENV: "1" } }),
        "utf8",
      );
      const spec = defineToolSpec({
        tool: { name: "envdemo" },
        command: {
          package: "io.example",
          exec: "tool",
          envPassthrough: ["TEST_ENV_FOO"],
          parameters: {},
          stdoutTransform: { shell: "jq -c .", format: "ndjson" },
        },
      });
      const cfg = await readRootConfig(tmp);
      const env = buildChildEnv(cfg as any, spec as any, {
        cleanEnv: true,
        passEnv: ["AWS_TOKEN_ABC"],
        setEnv: {},
      });
      if (!env.GLOBAL_ENV || env.TEST_ENV_FOO !== "x") {
        console.error("env policy mismatch", Object.keys(env));
        process.exit(2);
      }
      if (env.AWS_TOKEN_ABC !== "y") {
        console.error("AWS exact passthrough mismatch");
        process.exit(2);
      }
    });
  });
});
