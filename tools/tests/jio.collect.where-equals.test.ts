#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { defineToolSpec } from "../jio/spec";
import { runInTemp } from "./lib/test-helpers";

describe("jio --collect — --where= form", () => {
  test("--where= form is accepted and prints a path", async () => {
    await runInTemp("jio-where-equals", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      const dir = path.join(tmp, "t");
      await fsp.mkdir(dir, { recursive: true });
      const spec = defineToolSpec({
        tool: { name: "x" },
        command: { package: "io.example", exec: "bash", parameters: {} },
      });
      const p = path.join(dir, "x.tool.json");
      await fsp.writeFile(p, JSON.stringify(spec, null, 2), "utf8");
      const out = await $({ stdio: "pipe" })`jio --where=io.example.x`;
      const printed = String(out.stdout).trim();
      if (!printed.endsWith("x.tool.json")) {
        console.error("expected path to spec file");
        process.exit(2);
      }
    });
  });
});
