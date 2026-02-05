#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("python app scaffold includes pyproject.toml and uv.lock placeholder", async () => {
  await runInTemp("python-app-scaffold-files", async (tmp, _$) => {
    const $ = _$({ cwd: tmp, stdio: "inherit" });
    await $`git init`;

    const name = "demo_pyapp";
    await $`scaf new python app ${name} --yes`;

    const appDir = path.join(tmp, "projects", "apps", name);
    const pyproject = path.join(appDir, "pyproject.toml");
    const uvlock = path.join(appDir, "uv.lock");

    try {
      await fsp.access(pyproject);
    } catch {
      const listing = await fsp.readdir(appDir).catch(() => []);
      throw new Error(
        `pyproject.toml not created for python app scaffold; appDir=${appDir}; listing: ${listing}`,
      );
    }
    try {
      await fsp.access(uvlock);
    } catch {
      throw new Error("uv.lock placeholder not created for python app scaffold");
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
