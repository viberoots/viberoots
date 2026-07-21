#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { withoutArtifactEnvironmentInfluence } from "../../lib/artifact-environment";

const fixtureRunner = "viberoots/build-tools/tools/tests/dev/run-runnable.fixture.ts";

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
        ...withoutArtifactEnvironmentInfluence(process.env),
      },
    })`zx-wrapper ${fixtureRunner} --mode prod //projects/apps/demo:demo --fixture-manifest=${manifestPath}`;
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
        ...withoutArtifactEnvironmentInfluence(process.env),
        PATH: `${stubBin}:${process.env.PATH || ""}`,
      },
    })`zx-wrapper ${fixtureRunner} --mode dev //projects/apps/web:web --fixture-manifest=${manifestPath}`;
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
        ...withoutArtifactEnvironmentInfluence(process.env),
      },
    })`zx-wrapper ${fixtureRunner} --mode dev //projects/apps/demo:demo --fixture-manifest=${noDevManifestPath}`;
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
        ...withoutArtifactEnvironmentInfluence(process.env),
      },
    })`zx-wrapper ${fixtureRunner} --mode prod //projects/libs/core:core --fixture-manifest=${libraryManifestPath}`;
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
    await fsp.writeFile(serverEntry, `console.log('node-ok:' + process.argv[1]);\n`, "utf8");
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
              // SSR runnable contract requires argv[0] to be the literal
              // interpreter name ("node" / "pnpm"); the runtime resolves it
              // from PATH. Tests prepend stub-bin to PATH below.
              run: {
                prod: {
                  argv: ["node", serverEntry],
                },
                dev: {
                  argv: ["pnpm", "--dir", "projects/apps/ssr", "dev:ssr"],
                },
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
        ...withoutArtifactEnvironmentInfluence(process.env),
        PATH: `${stubBin}:${process.env.PATH || ""}`,
      },
    })`zx-wrapper ${fixtureRunner} --mode prod //projects/apps/ssr:app --fixture-manifest=${manifestPath}`;
    assert.match(
      String(prod.stdout || ""),
      new RegExp(`node-ok:${serverEntry.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
    );

    const dev = await $({
      cwd: tmp,
      stdio: "pipe",
      env: {
        ...withoutArtifactEnvironmentInfluence(process.env),
        PATH: `${stubBin}:${process.env.PATH || ""}`,
      },
    })`zx-wrapper ${fixtureRunner} --mode dev //projects/apps/ssr:app --fixture-manifest=${manifestPath}`;
    assert.match(String(dev.stdout || ""), /pnpm-ok:--dir projects\/apps\/ssr dev:ssr/);
  });
});

test("public runnable entrypoint exposes no fixture manifest override", async () => {
  const source = await fsp.readFile(new URL("../../dev/run-runnable.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /(?:test|fixture)-manifest/);
});
