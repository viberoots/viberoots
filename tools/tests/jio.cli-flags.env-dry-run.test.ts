#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { defineToolSpec } from "../jio/spec";
import { runInTemp } from "./lib/test-helpers";

describe("jio CLI flags: dry-run env reflects clean/pass/set", () => {
  test("--dry-run envKeys honor --clean-env, --pass-env, and --env", async () => {
    await runInTemp("jio-cli-env-dry-run", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example", env: { ROOT_ONLY: "R" } }),
        "utf8",
      );
      const dir = path.join(tmp, "t");
      await fsp.mkdir(dir, { recursive: true });
      const spec = defineToolSpec({
        tool: { name: "noop" },
        command: {
          package: "io.example",
          exec: "bash",
          parameters: {
            sub: { type: "string", value: "-lc", position: 1 },
            cmd: { type: "string", value: "echo '{}'", position: 2 },
          },
        },
      });
      await fsp.writeFile(path.join(dir, "noop.tool.json"), JSON.stringify(spec, null, 2), "utf8");

      // With clean env (default), parent vars are not present except keep-list; pass-env can add specific
      const out1 = await $({
        stdio: "pipe",
      })`bash --noprofile --norc -lc ${`FOO=X BAR=Y jio io.example.noop --dry-run --pass-env FOO --env SET_ONLY=Z`}`;
      const plan1 = JSON.parse(String(out1.stdout || "{}"));
      const keys1: string[] = plan1.envKeys || [];
      if (
        !Array.isArray(keys1) ||
        !keys1.includes("ROOT_ONLY") ||
        !keys1.includes("SET_ONLY") ||
        !keys1.includes("FOO")
      ) {
        console.error(
          "expected dry-run envKeys to include ROOT_ONLY, SET_ONLY, FOO under clean env",
        );
        process.exit(2);
      }
      if (keys1.includes("BAR")) {
        console.error("expected BAR to be absent without pass-env under clean env");
        process.exit(2);
      }

      // With no-clean-env, parent env should pass through wholesale; pass-env doesn't restrict
      const out2 = await $({
        stdio: "pipe",
      })`bash --noprofile --norc -lc ${`FOO=X BAR=Y jio io.example.noop --dry-run --no-clean-env`}`;
      const plan2 = JSON.parse(String(out2.stdout || "{}"));
      const keys2: string[] = plan2.envKeys || [];
      if (!keys2.includes("FOO") || !keys2.includes("BAR")) {
        console.error("expected FOO and BAR present under --no-clean-env in dry-run envKeys");
        process.exit(2);
      }
    });
  });
});
