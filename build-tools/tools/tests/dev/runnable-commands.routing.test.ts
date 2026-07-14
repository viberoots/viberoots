#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { runCommand } from "../../dev/run-runnable-core";

test("runnable Python bypasses a hostile host PATH entry for the Nix-store tool", async () => {
  const root = await fsp.mkdtemp(
    path.join(process.cwd(), ".viberoots/workspace/buck/tmp/python-path-"),
  );
  const hostBin = path.join(root, "host-bin");
  const hostMarker = path.join(root, "host-python-ran");
  const storeMarker = path.join(root, "store-python-ran");
  const originalPath = process.env.PATH;
  try {
    await fsp.mkdir(hostBin, { recursive: true });
    const hostilePython = path.join(hostBin, "python3");
    await fsp.writeFile(hostilePython, `#!/bin/sh\n: > '${hostMarker}'\nexit 91\n`, "utf8");
    await fsp.chmod(hostilePython, 0o755);
    process.env.PATH = `${hostBin}${path.delimiter}${originalPath || ""}`;

    const code = await runCommand(
      [
        "python3",
        "-c",
        `from pathlib import Path; Path(${JSON.stringify(storeMarker)}).write_text('ok')`,
      ],
      [],
    );
    assert.equal(code, 0);
    assert.equal(await fsp.readFile(storeMarker, "utf8"), "ok");
    await assert.rejects(fsp.access(hostMarker));
  } finally {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("runnable Python rejects an absolute command in a nested fake Nix store", async () => {
  const fakePython = path.join(
    process.cwd(),
    ".viberoots/workspace/buck/tmp/nix/store/hostile/bin/python3",
  );
  await assert.rejects(
    runCommand([fakePython, "-c", "raise SystemExit(0)"], []),
    /runnable tool must resolve to \/nix\/store/,
  );
});

test("p routes to run.prod", async () => {
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
    })`viberoots/build-tools/tools/bin/p //projects/apps/demo:demo`;
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
    })`viberoots/build-tools/tools/bin/d //projects/apps/web:web`;
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
    })`viberoots/build-tools/tools/bin/d //projects/apps/demo:demo`;
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
    })`viberoots/build-tools/tools/bin/p //projects/libs/core:core`;
    assert.notEqual(libraryRun.exitCode, 0);
    assert.match(String(libraryRun.stderr || ""), /library-only/);
  });
});

test("SSR runnable routes to canonical node prod and dev:ssr commands", async () => {
  await runInTemp("runnable-routes-ssr", async (tmp, $) => {
    const manifestPath = path.join(tmp, "buck-out", "tmp", "runnable.ssr.manifest.json");
    await fsp.mkdir(path.dirname(manifestPath), { recursive: true });
    const outPath = path.join(tmp, "buck-out", "tmp", "ssr-out");
    const serverEntry = path.join(outPath, "dist", "server", "index.js");
    const clientDir = path.join(outPath, "dist", "client");
    await fsp.mkdir(path.dirname(serverEntry), { recursive: true });
    await fsp.mkdir(clientDir, { recursive: true });
    await fsp.writeFile(serverEntry, "console.log('server');\n", "utf8");
    await fsp.writeFile(
      manifestPath,
      JSON.stringify(
        [
          {
            label: "//projects/apps/ssr:app",
            kind: "app",
            bins: [],
            aux: [],
            runnable: {
              kind: "webapp-ssr",
              framework: "vite",
              run: {
                prod: { argv: ["node", serverEntry] },
                dev: { argv: ["pnpm", "--dir", "projects/apps/ssr", "dev:ssr"] },
              },
              artifacts: { serverEntry, clientDir },
            },
          },
        ],
        null,
        2,
      ) + "\n",
      "utf8",
    );

    const stubBin = path.join(tmp, "stub-bin");
    await fsp.mkdir(stubBin, { recursive: true });
    const nodeStub = path.join(stubBin, "node");
    const pnpmStub = path.join(stubBin, "pnpm");
    await fsp.writeFile(nodeStub, "#!/usr/bin/env bash\necho node-ok:$*\n", "utf8");
    await fsp.writeFile(pnpmStub, "#!/usr/bin/env bash\necho pnpm-ok:$*\n", "utf8");
    await $`chmod +x ${nodeStub} ${pnpmStub}`;

    const prod = await $({
      cwd: tmp,
      stdio: "pipe",
      env: {
        ...process.env,
        PATH: `${stubBin}:${process.env.PATH || ""}`,
        RUNNABLE_TEST_MANIFEST: manifestPath,
      },
    })`viberoots/build-tools/tools/bin/p //projects/apps/ssr:app`;
    assert.match(
      String(prod.stdout || ""),
      new RegExp(`node-ok:${serverEntry.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
    );

    const dev = await $({
      cwd: tmp,
      stdio: "pipe",
      env: {
        ...process.env,
        PATH: `${stubBin}:${process.env.PATH || ""}`,
        RUNNABLE_TEST_MANIFEST: manifestPath,
      },
    })`viberoots/build-tools/tools/bin/d //projects/apps/ssr:app`;
    assert.match(String(dev.stdout || ""), /pnpm-ok:--dir projects\/apps\/ssr dev:ssr/);
  });
});
