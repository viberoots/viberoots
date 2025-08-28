#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { defineToolSpec } from "../json-cli/spec";
import { runInTemp } from "./lib/test-helpers";

describe("json-cli working directory resolution", () => {
  test("defaults to spec directory when inheritCallerCwd is false", async () => {
    await runInTemp("json-cli-cwd-spec", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".json-cli"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      const specDir = path.join(tmp, "specdir");
      const subDir = path.join(specDir, "sub");
      await fsp.mkdir(subDir, { recursive: true });
      const spec = defineToolSpec({
        tool: { name: "touch" },
        command: {
          package: "io.example",
          exec: "bash",
          workingDir: "sub",
          parameters: {
            a: { type: "string", value: "-lc", position: 1 },
            s: { type: "string", value: "echo hi > here.txt", position: 2 },
          },
          stdoutTransform: { shell: "jq -nc '{ok:true}'", format: "ndjson" },
        },
      });
      await fsp.writeFile(
        path.join(specDir, "touch.tool.json"),
        JSON.stringify(spec, null, 2),
        "utf8",
      );
      await $({ cwd: tmp })`json-cli io.example.touch --dry-run`;
      // Dry run doesn't execute. Now run real and verify file placement.
      await $({ cwd: tmp })`json-cli io.example.touch`;
      const exists = await fsp
        .stat(path.join(subDir, "here.txt"))
        .then(() => true)
        .catch(() => false);
      if (!exists) {
        console.error("expected here.txt under specdir/sub");
        process.exit(2);
      }
    });
  });

  test("inherits caller CWD when inheritCallerCwd is true", async () => {
    await runInTemp("json-cli-cwd-inherit", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".json-cli"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      const specDir = path.join(tmp, "specdir2");
      await fsp.mkdir(specDir, { recursive: true });
      const spec = defineToolSpec({
        tool: { name: "pwd" },
        command: {
          package: "io.example",
          exec: "pwd",
          inheritCallerCwd: true,
          parameters: {},
          stdoutTransform: { shell: "jq -R -c '{cwd: .}'", format: "ndjson" },
        },
      });
      await fsp.writeFile(
        path.join(specDir, "pwd.tool.json"),
        JSON.stringify(spec, null, 2),
        "utf8",
      );
      const out = await $({ stdio: "pipe", cwd: tmp })`json-cli io.example.pwd`;
      const s = String(out.stdout).trim();
      const obj = JSON.parse(s);
      const realTmp = await fsp.realpath(tmp);
      if (obj.cwd !== realTmp) {
        console.error(`expected cwd to equal ${realTmp}, got: ${obj.cwd}`);
        process.exit(2);
      }
    });
  });
});
