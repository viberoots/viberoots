#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers.ts";

test("r routes to run.prod", async () => {
  await runInTemp("runnable-routes-prod", async (tmp, $) => {
    const outPath = path.join(tmp, "buck-out", "tmp", "runnable-out");
    await fsp.mkdir(path.join(outPath, "bin"), { recursive: true });
    const prog = path.join(outPath, "bin", "demo");
    await fsp.writeFile(prog, "#!/usr/bin/env bash\necho prod-ok\n", "utf8");
    await $`chmod +x ${prog}`;
    const manifestPath = path.join(tmp, "buck-out", "tmp", "runnable.manifest.json");
    await fsp.mkdir(path.dirname(manifestPath), { recursive: true });
    await fsp.writeFile(
      manifestPath,
      JSON.stringify(
        [
          {
            label: "//projects/apps/demo:demo",
            kind: "bin",
            bins: [prog],
            aux: [],
            runnable: {
              kind: "native-bin",
              run: { prod: { argv: [prog] } },
              artifacts: { bins: [prog] },
            },
          },
        ],
        null,
        2,
      ) + "\n",
      "utf8",
    );

    const { stdout } = await $({
      cwd: tmp,
      stdio: "pipe",
      env: {
        ...process.env,
        RUNNABLE_TEST_MANIFEST: manifestPath,
      },
    })`build-tools/tools/bin/r //projects/apps/demo:demo`;
    assert.match(String(stdout || ""), /prod-ok/);
  });
});

test("d routes to run.dev and fails clearly when unavailable", async () => {
  await runInTemp("runnable-routes-dev", async (tmp, $) => {
    const outPath = path.join(tmp, "buck-out", "tmp", "runnable-web");
    await fsp.mkdir(path.join(outPath, "dist"), { recursive: true });
    await fsp.writeFile(path.join(outPath, "dist", "index.html"), "<html>ok</html>", "utf8");

    const stubBin = path.join(tmp, "stub-bin");
    await fsp.mkdir(stubBin, { recursive: true });
    const pnpmStub = path.join(stubBin, "pnpm");
    await fsp.writeFile(pnpmStub, "#!/usr/bin/env bash\necho dev-ok\n", "utf8");
    await $`chmod +x ${pnpmStub}`;
    const manifestPath = path.join(tmp, "buck-out", "tmp", "runnable.manifest.json");
    await fsp.mkdir(path.dirname(manifestPath), { recursive: true });
    await fsp.writeFile(
      manifestPath,
      JSON.stringify(
        [
          {
            label: "//projects/apps/web:web",
            kind: "app",
            bins: [],
            aux: [],
            runnable: {
              kind: "webapp",
              run: {
                prod: {
                  argv: ["python3", "-m", "http.server", "--directory", path.join(outPath, "dist")],
                },
                dev: { argv: ["pnpm", "--dir", "projects/apps/web", "dev"] },
              },
              artifacts: { dist: path.join(outPath, "dist") },
            },
          },
        ],
        null,
        2,
      ) + "\n",
      "utf8",
    );

    const dev = await $({
      cwd: tmp,
      stdio: "pipe",
      env: {
        ...process.env,
        PATH: `${stubBin}:${process.env.PATH || ""}`,
        RUNNABLE_TEST_MANIFEST: manifestPath,
      },
    })`build-tools/tools/bin/d //projects/apps/web:web`;
    assert.match(String(dev.stdout || ""), /dev-ok/);

    const noDevManifestPath = path.join(tmp, "buck-out", "tmp", "runnable.no-dev.manifest.json");
    await fsp.writeFile(
      noDevManifestPath,
      JSON.stringify(
        [
          {
            label: "//projects/apps/demo:demo",
            kind: "bin",
            bins: ["/nix/store/fake/bin/demo"],
            aux: [],
            runnable: {
              kind: "native-bin",
              run: { prod: { argv: ["/nix/store/fake/bin/demo"] } },
              artifacts: { bins: ["/nix/store/fake/bin/demo"] },
            },
          },
        ],
        null,
        2,
      ) + "\n",
      "utf8",
    );
    const missing = await $({
      cwd: tmp,
      stdio: "pipe",
      nothrow: true,
      env: {
        ...process.env,
        RUNNABLE_TEST_MANIFEST: noDevManifestPath,
      },
    })`build-tools/tools/bin/d //projects/apps/demo:demo`;
    assert.notEqual(missing.exitCode, 0);
    assert.match(String(missing.stderr || ""), /run\.dev is not available/);

    const libraryManifestPath = path.join(tmp, "buck-out", "tmp", "runnable.lib.manifest.json");
    await fsp.writeFile(
      libraryManifestPath,
      JSON.stringify(
        [{ label: "//projects/libs/core:core", kind: "lib", bins: [], aux: [] }],
        null,
        2,
      ) + "\n",
      "utf8",
    );
    const libraryRun = await $({
      cwd: tmp,
      stdio: "pipe",
      nothrow: true,
      env: {
        ...process.env,
        RUNNABLE_TEST_MANIFEST: libraryManifestPath,
      },
    })`build-tools/tools/bin/r //projects/libs/core:core`;
    assert.notEqual(libraryRun.exitCode, 0);
    assert.match(String(libraryRun.stderr || ""), /library-only/);
  });
});
