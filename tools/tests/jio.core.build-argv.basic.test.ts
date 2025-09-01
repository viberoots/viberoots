#!/usr/bin/env zx-wrapper
import { describe, test } from "node:test";
import { buildArgv } from "../../tools/jio/core/index.ts";
import { defineToolSpec } from "../jio/spec";
import { runInTemp } from "./lib/test-helpers";

describe("jio core — buildArgv basics", () => {
  test("positional + flags + csv/separate", async () => {
    await runInTemp("jio-core-argv", async (tmp, $) => {
      const spec = defineToolSpec({
        tool: { name: "opts" },
        command: {
          package: "io.example",
          exec: "tool",
          parameters: {
            pos: { type: "string", value: "run", position: 1 },
            nameEq: { type: "string", flag: true, flagName: "--name", value: "alice" },
            listCsvSep: {
              type: "array",
              flag: true,
              flagName: "--list",
              collectionStyle: "csv",
              csvSeparator: ",",
              flagValueStyle: "separate",
              value: ["a", "b"],
            },
          },
          stdoutTransform: { shell: "jq -c .", format: "ndjson" },
        },
      });
      const argv = buildArgv(spec as any, {});
      const expect = ["run", "--name=alice", "--list", "a,b"];
      const ok = expect.every((t) => argv.includes(t));
      if (!ok) {
        console.error("argv mismatch:", argv);
        process.exit(2);
      }
    });
  });
});
