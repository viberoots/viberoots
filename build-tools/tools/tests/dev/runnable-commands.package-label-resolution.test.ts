#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers.ts";

test("p resolves package label to runnable target label", async () => {
  await runInTemp("runnable-package-label-resolution", async (tmp, $) => {
    const graphDir = path.join(tmp, "build-tools", "tools", "buck");
    const graphPath = path.join(graphDir, "graph.json");
    await fsp.mkdir(graphDir, { recursive: true });
    await fsp.writeFile(
      graphPath,
      JSON.stringify(
        [
          {
            name: "//projects/apps/demo:app",
            rule_type: "node_asset_stage",
            labels: [
              "lang:node",
              "kind:app",
              "webapp:ssr",
              "framework:vite",
              "lockfile:projects/apps/demo/pnpm-lock.yaml#projects/apps/demo",
            ],
            srcs: ["projects/apps/demo/src/entry-server.ts"],
            deps: [],
          },
        ],
        null,
        2,
      ) + "\n",
      "utf8",
    );

    const stubBin = path.join(tmp, "stub-bin");
    const fakeOut = path.join(tmp, "fake-selected-out");
    const targetLog = path.join(tmp, "buck-target.log");
    await fsp.mkdir(stubBin, { recursive: true });
    await fsp.writeFile(
      path.join(stubBin, "nix"),
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        `echo \"${"$"}{BUCK_TARGET}\" >> ${JSON.stringify(targetLog)}`,
        `out=${JSON.stringify(fakeOut)}`,
        'mkdir -p "$out/bin"',
        "cat > \"$out/bin/demo\" <<'EOF'",
        "#!/usr/bin/env bash",
        "echo package-resolution-ok",
        "EOF",
        'chmod +x "$out/bin/demo"',
        'echo "$out"',
        "",
      ].join("\n"),
      "utf8",
    );
    await $`chmod +x ${path.join(stubBin, "nix")}`;

    const run = await $({
      cwd: tmp,
      stdio: "pipe",
      env: {
        ...process.env,
        PATH: `${stubBin}:${process.env.PATH || ""}`,
      },
    })`build-tools/tools/bin/p //projects/apps/demo`;
    assert.match(String(run.stdout || ""), /package-resolution-ok/);

    const loggedTarget = String(await fsp.readFile(targetLog, "utf8")).trim();
    assert.equal(loggedTarget, "//projects/apps/demo:app");
  });
});

test("p resolves relative and absolute directory paths to runnable target label", async () => {
  await runInTemp("runnable-path-label-resolution", async (tmp, $) => {
    const graphDir = path.join(tmp, "build-tools", "tools", "buck");
    const graphPath = path.join(graphDir, "graph.json");
    await fsp.mkdir(graphDir, { recursive: true });
    await fsp.writeFile(
      graphPath,
      JSON.stringify(
        [
          {
            name: "//projects/apps/demo:app",
            rule_type: "node_asset_stage",
            labels: [
              "lang:node",
              "kind:app",
              "webapp:ssr",
              "framework:vite",
              "lockfile:projects/apps/demo/pnpm-lock.yaml#projects/apps/demo",
            ],
            srcs: ["projects/apps/demo/src/entry-server.ts"],
            deps: [],
          },
        ],
        null,
        2,
      ) + "\n",
      "utf8",
    );

    const stubBin = path.join(tmp, "stub-bin");
    const fakeOut = path.join(tmp, "fake-selected-out");
    const targetLog = path.join(tmp, "buck-target.log");
    await fsp.mkdir(stubBin, { recursive: true });
    await fsp.writeFile(
      path.join(stubBin, "nix"),
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        `echo \"${"$"}{BUCK_TARGET}\" >> ${JSON.stringify(targetLog)}`,
        `out=${JSON.stringify(fakeOut)}`,
        'mkdir -p "$out/bin"',
        "cat > \"$out/bin/demo\" <<'EOF'",
        "#!/usr/bin/env bash",
        "echo path-resolution-ok",
        "EOF",
        'chmod +x "$out/bin/demo"',
        'echo "$out"',
        "",
      ].join("\n"),
      "utf8",
    );
    await $`chmod +x ${path.join(stubBin, "nix")}`;

    const commonEnv = {
      ...process.env,
      PATH: `${stubBin}:${process.env.PATH || ""}`,
    };
    const relativeRun = await $({
      cwd: tmp,
      stdio: "pipe",
      env: commonEnv,
    })`build-tools/tools/bin/p projects/apps/demo`;
    assert.match(String(relativeRun.stdout || ""), /path-resolution-ok/);

    const absoluteRun = await $({
      cwd: tmp,
      stdio: "pipe",
      env: commonEnv,
    })`build-tools/tools/bin/p ${path.join(tmp, "projects", "apps", "demo")}`;
    assert.match(String(absoluteRun.stdout || ""), /path-resolution-ok/);

    const loggedTargets = String(await fsp.readFile(targetLog, "utf8"))
      .split(/\n+/)
      .map((x) => x.trim())
      .filter(Boolean);
    assert.deepEqual(loggedTargets, ["//projects/apps/demo:app", "//projects/apps/demo:app"]);
  });
});

test("d resolves current directory path (.) from package cwd", async () => {
  await runInTemp("runnable-dot-cwd-resolution", async (tmp, $) => {
    const graphDir = path.join(tmp, "build-tools", "tools", "buck");
    await fsp.mkdir(graphDir, { recursive: true });
    await fsp.writeFile(
      path.join(graphDir, "graph.json"),
      JSON.stringify(
        [
          {
            name: "//projects/apps/demo:app",
            rule_type: "node_asset_stage",
            labels: [
              "lang:node",
              "kind:app",
              "webapp:ssr",
              "framework:vite",
              "lockfile:projects/apps/demo/pnpm-lock.yaml#projects/apps/demo",
            ],
            srcs: ["projects/apps/demo/src/entry-server.ts"],
            deps: [],
          },
        ],
        null,
        2,
      ) + "\n",
      "utf8",
    );

    const appDir = path.join(tmp, "projects", "apps", "demo");
    await fsp.mkdir(appDir, { recursive: true });
    const tmpReal = await fsp.realpath(tmp).catch(() => tmp);
    const stubBin = path.join(tmp, "stub-bin");
    const fakeOut = path.join(tmp, "fake-selected-out");
    const targetLog = path.join(tmp, "buck-target-dot.log");
    await fsp.mkdir(stubBin, { recursive: true });
    await fsp.writeFile(
      path.join(stubBin, "nix"),
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        `echo \"${"$"}{BUCK_TARGET}\" >> ${JSON.stringify(targetLog)}`,
        `out=${JSON.stringify(fakeOut)}`,
        'mkdir -p "$out/bin"',
        "cat > \"$out/bin/demo\" <<'EOF'",
        "#!/usr/bin/env bash",
        "echo dot-resolution-ok",
        "EOF",
        'chmod +x "$out/bin/demo"',
        'echo "$out"',
        "",
      ].join("\n"),
      "utf8",
    );
    await fsp.writeFile(
      path.join(stubBin, "pnpm"),
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        `if [[ "$PWD" != ${JSON.stringify(tmp)} && "$PWD" != ${JSON.stringify(tmpReal)} ]]; then`,
        '  echo "unexpected-cwd:$PWD" >&2',
        "  exit 98",
        "fi",
        "echo dev-dot-ok",
        "",
      ].join("\n"),
      "utf8",
    );
    await $`chmod +x ${path.join(stubBin, "nix")} ${path.join(stubBin, "pnpm")}`;

    const run = await $({
      cwd: appDir,
      stdio: "pipe",
      env: {
        ...process.env,
        PATH: `${stubBin}:${process.env.PATH || ""}`,
      },
    })`${path.join(tmp, "build-tools", "tools", "bin", "d")} .`;
    assert.match(String(run.stdout || ""), /dev-dot-ok/);
    const loggedTarget = String(await fsp.readFile(targetLog, "utf8")).trim();
    assert.equal(loggedTarget, "//projects/apps/demo:app");
  });
});
