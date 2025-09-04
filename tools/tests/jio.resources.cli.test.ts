#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { runInTemp } from "./lib/test-helpers";

describe("jio resources CLI", () => {
  test("--list-resources and --where-resource work", async () => {
    await runInTemp("resources-cli", async (tmp, $) => {
      const dataDir = path.join(tmp, "d");
      const specDir = path.join(tmp, "m");
      await fsp.mkdir(dataDir, { recursive: true });
      await fsp.mkdir(specDir, { recursive: true });
      const file = path.join(dataDir, "r.json");
      await fsp.writeFile(file, "{}", "utf8");
      await fsp.writeFile(
        path.join(specDir, "x.resource.json"),
        JSON.stringify({ id: "res.x", name: "X", file: "../d/r.json" }),
        "utf8",
      );
      const outList = await $({ cwd: tmp, stdio: "pipe" })`jio --list-resources`;
      const s = String(outList.stdout || "");
      if (!s.includes("res.x\t")) {
        console.error("expected list-resources to include res.x", s);
        process.exit(2);
      }
      const outWhere = await $({ cwd: tmp, stdio: "pipe" })`jio --where-resource res.x`;
      const p = String(outWhere.stdout || "").trim();
      if (!p || !p.endsWith("/d/r.json")) {
        console.error("expected where-resource to print abs path to r.json", p);
        process.exit(2);
      }
    });
  });
});
