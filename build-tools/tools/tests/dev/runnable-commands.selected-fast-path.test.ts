#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("p uses graph-generator-selected and skips full graph-generator for runnable target", async () => {
  await runInTemp("runnable-selected-fast-path", async (tmp, $) => {
    const target = "//projects/apps/demo:demo";
    const graphDir = path.join(tmp, ".viberoots", "workspace", "buck");
    await fsp.mkdir(graphDir, { recursive: true });
    await fsp.writeFile(
      path.join(graphDir, "graph.json"),
      JSON.stringify(
        [
          {
            name: target,
            rule_type: "nix_node_cli_bin",
            labels: [
              "lang:node",
              "kind:bin",
              "lockfile:projects/apps/demo/pnpm-lock.yaml#projects/apps/demo",
            ],
            srcs: ["projects/apps/demo/src/index.ts"],
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
    const nixLog = path.join(tmp, "nix-args.log");
    await fsp.mkdir(stubBin, { recursive: true });
    await fsp.writeFile(
      path.join(stubBin, "nix"),
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        `echo \"$*\" >> ${JSON.stringify(nixLog)}`,
        'args="$*"',
        `out=${JSON.stringify(fakeOut)}`,
        'if [[ "$args" == *"graph-generator-selected"* ]]; then',
        '  mkdir -p "$out/bin"',
        "  cat > \"$out/bin/demo\" <<'EOF'",
        "#!/usr/bin/env bash",
        "echo selected-prod-ok",
        "EOF",
        '  chmod +x "$out/bin/demo"',
        '  echo "$out"',
        "  exit 0",
        "fi",
        'if [[ "$args" == *"graph-generator"* ]]; then',
        '  echo "full graph-generator should not be called" >&2',
        "  exit 91",
        "fi",
        'echo "unexpected nix invocation: $args" >&2',
        "exit 92",
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
    })`viberoots/build-tools/tools/bin/p ${target}`;
    assert.match(String(run.stdout || ""), /selected-prod-ok/);
    assert.doesNotMatch(
      String(run.stderr || ""),
      /creating filtered source snapshot/i,
      "temp runnable path should avoid filtered flake snapshot in auto source mode",
    );

    const logTxt = await fsp.readFile(nixLog, "utf8");
    assert.match(logTxt, /graph-generator-selected/);
    assert.doesNotMatch(logTxt, /(^|\s)graph-generator(\s|$)/);
  });
});

test("p auto source falls back to path flake for relevant untracked files", async () => {
  await runInTemp("runnable-selected-auto-source", async (tmp, $) => {
    const target = "//projects/apps/demo:demo";
    const graphDir = path.join(tmp, ".viberoots", "workspace", "buck");
    const projectDir = path.join(tmp, "projects", "apps", "demo");
    await fsp.mkdir(graphDir, { recursive: true });
    await fsp.mkdir(path.join(projectDir, "src"), { recursive: true });
    await fsp.writeFile(path.join(projectDir, "package.json"), '{"scripts":{}}\n', "utf8");
    await fsp.writeFile(
      path.join(projectDir, "pnpm-lock.yaml"),
      "lockfileVersion: '9.0'\n",
      "utf8",
    );
    await fsp.writeFile(path.join(projectDir, "src", "index.ts"), "console.log('ok');\n", "utf8");
    await fsp.writeFile(path.join(projectDir, "NEW_UNTRACKED.txt"), "untracked\n", "utf8");
    await fsp.writeFile(
      path.join(graphDir, "graph.json"),
      JSON.stringify(
        [
          {
            name: target,
            rule_type: "nix_node_cli_bin",
            labels: [
              "lang:node",
              "kind:bin",
              "lockfile:projects/apps/demo/pnpm-lock.yaml#projects/apps/demo",
            ],
            srcs: ["projects/apps/demo/src/index.ts"],
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
    const nixLog = path.join(tmp, "nix-args.log");
    await fsp.mkdir(stubBin, { recursive: true });
    await fsp.writeFile(
      path.join(stubBin, "nix"),
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        `echo \"$*\" >> ${JSON.stringify(nixLog)}`,
        'args="$*"',
        `out=${JSON.stringify(fakeOut)}`,
        'if [[ "$args" == *"graph-generator-selected"* ]]; then',
        '  mkdir -p "$out/bin"',
        "  cat > \"$out/bin/demo\" <<'EOF'",
        "#!/usr/bin/env bash",
        "echo selected-prod-ok",
        "EOF",
        '  chmod +x "$out/bin/demo"',
        '  echo "$out"',
        "  exit 0",
        "fi",
        'if [[ "$args" == *"graph-generator"* ]]; then',
        '  echo "full graph-generator should not be called" >&2',
        "  exit 91",
        "fi",
        'echo "unexpected nix invocation: $args" >&2',
        "exit 92",
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
    })`viberoots/build-tools/tools/bin/p ${target}`;
    assert.match(String(run.stdout || ""), /selected-prod-ok/);

    const logTxt = await fsp.readFile(nixLog, "utf8");
    assert.match(logTxt, /path:.*#graph-generator-selected/);
    const flakeRef = String(logTxt.match(/(path:[^ ]+#graph-generator-selected)/)?.[1] || "");
    assert.ok(flakeRef, `expected path flake ref in nix log: ${logTxt}`);
    const flakeDir = flakeRef.replace(/^path:/, "").replace(/#graph-generator-selected$/, "");
    const snapshotRoot = flakeDir.endsWith(path.join(".viberoots", "workspace"))
      ? path.join(flakeDir, "..", "..")
      : flakeDir;
    await fsp.access(path.join(snapshotRoot, "projects", "apps", "demo", "pnpm-lock.yaml"));
  });
});

test("p --source=git keeps git flake source even with relevant untracked files", async () => {
  await runInTemp("runnable-selected-git-source", async (tmp, $) => {
    const target = "//projects/apps/demo:demo";
    const graphDir = path.join(tmp, ".viberoots", "workspace", "buck");
    const projectDir = path.join(tmp, "projects", "apps", "demo");
    await fsp.mkdir(graphDir, { recursive: true });
    await fsp.mkdir(path.join(projectDir, "src"), { recursive: true });
    await fsp.writeFile(path.join(projectDir, "src", "index.ts"), "console.log('ok');\n", "utf8");
    await fsp.writeFile(path.join(projectDir, "NEW_UNTRACKED.txt"), "untracked\n", "utf8");
    await fsp.writeFile(
      path.join(graphDir, "graph.json"),
      JSON.stringify(
        [
          {
            name: target,
            rule_type: "nix_node_cli_bin",
            labels: [
              "lang:node",
              "kind:bin",
              "lockfile:projects/apps/demo/pnpm-lock.yaml#projects/apps/demo",
            ],
            srcs: ["projects/apps/demo/src/index.ts"],
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
    const nixLog = path.join(tmp, "nix-args.log");
    await fsp.mkdir(stubBin, { recursive: true });
    await fsp.writeFile(
      path.join(stubBin, "nix"),
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        `echo \"$*\" >> ${JSON.stringify(nixLog)}`,
        'args="$*"',
        `out=${JSON.stringify(fakeOut)}`,
        'if [[ "$args" == *"graph-generator-selected"* ]]; then',
        '  mkdir -p "$out/bin"',
        "  cat > \"$out/bin/demo\" <<'EOF'",
        "#!/usr/bin/env bash",
        "echo selected-prod-ok",
        "EOF",
        '  chmod +x "$out/bin/demo"',
        '  echo "$out"',
        "  exit 0",
        "fi",
        'if [[ "$args" == *"graph-generator"* ]]; then',
        '  echo "full graph-generator should not be called" >&2',
        "  exit 91",
        "fi",
        'echo "unexpected nix invocation: $args" >&2',
        "exit 92",
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
    })`viberoots/build-tools/tools/bin/p ${target} --source=git`;
    assert.match(String(run.stdout || ""), /selected-prod-ok/);

    const logTxt = await fsp.readFile(nixLog, "utf8");
    assert.doesNotMatch(logTxt, /path:.*#graph-generator-selected/);
    assert.match(logTxt, /#graph-generator-selected/);
  });
});
