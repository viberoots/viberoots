#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("python lib scaffold includes pyproject.toml and uv.lock placeholder", async () => {
  await runInTemp("python-lib-scaffold-files", async (tmp, _$) => {
    const $ = _$({ cwd: tmp, stdio: "inherit" });
    await $`git init`;

    const name = "demo_pylib";
    await $`scaf new python lib ${name} --yes`;

    const libDir = path.join(tmp, "projects", "libs", name);
    const pyproject = path.join(libDir, "pyproject.toml");
    const uvlock = path.join(libDir, "uv.lock");

    try {
      await fsp.access(pyproject);
    } catch {
      const listing = await fsp.readdir(libDir).catch(() => []);
      throw new Error(
        `pyproject.toml not created for python lib scaffold; dir listing: ${listing}`,
      );
    }
    try {
      await fsp.access(uvlock);
    } catch {
      throw new Error("uv.lock placeholder not created for python lib scaffold");
    }

    const pyTxt = await fsp.readFile(pyproject, "utf8");
    if (!pyTxt.includes("[project]") || !pyTxt.includes('requires = ["hatchling"]')) {
      throw new Error("pyproject.toml missing required PEP 621 or hatchling sections");
    }
    const uvTxt = await fsp.readFile(uvlock, "utf8");
    if (!uvTxt.includes("uv lockfile")) {
      throw new Error("uv.lock placeholder missing expected header");
    }
  });
});
