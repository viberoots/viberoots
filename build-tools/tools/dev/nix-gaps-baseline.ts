#!/usr/bin/env zx-wrapper
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { getFlagBool, getFlagStr } from "../lib/cli";
import { writeIfChanged } from "../lib/fs-helpers";

type CommandResult = {
  label: string;
  command: string;
  elapsedMs: number | null;
  output: string;
  status: "ok" | "error" | "skipped";
};

function runCommand(command: string, args: string[], env?: Record<string, string>): CommandResult {
  const label = [command, ...args].join(" ");
  const start = Date.now();
  try {
    const res = spawnSync(command, args, {
      env: { ...process.env, ...(env || {}) },
      encoding: "utf8",
      stdio: "pipe",
    });
    const elapsedMs = Date.now() - start;
    const stdout = String(res.stdout || "").trim();
    if (res.status === 0 && stdout) {
      return { label, command: label, elapsedMs, output: stdout, status: "ok" };
    }
    const stderr = String(res.stderr || "").trim();
    const output = stdout || stderr || "no output";
    return { label, command: label, elapsedMs, output, status: "error" };
  } catch (err: any) {
    const elapsedMs = Date.now() - start;
    const output = String(err?.message || "failed to run").trim();
    return { label, command: label, elapsedMs, output, status: "error" };
  }
}

function formatTiming(result: CommandResult): string {
  if (result.status === "skipped") return "skipped";
  if (result.elapsedMs === null) return "unknown";
  return `${result.elapsedMs}ms`;
}

function renderCommands(results: CommandResult[]): string {
  return results
    .map((r) => {
      const timing = formatTiming(r);
      if (r.status === "skipped") {
        return `- \`${r.command}\` (${timing}): ${r.output}`;
      }
      return `- \`${r.command}\` (${timing}): ${r.output}`;
    })
    .join("\n");
}

function fixtureResults(): {
  env: Record<string, string>;
  tools: CommandResult[];
  buildSteps: CommandResult[];
  now: string;
} {
  const now = "2000-01-01T00:00:00.000Z";
  return {
    now,
    env: {
      repo: "/path/to/repo",
      platform: "darwin",
      release: "0.0.0",
      node: "v22.0.0",
      head: "0123456789abcdef",
      dirty: "false",
    },
    tools: [
      {
        label: "nix --version",
        command: "nix --version",
        elapsedMs: 12,
        output: "nix (Nix) 2.0.0",
        status: "ok",
      },
      {
        label: "buck2 --version",
        command: "buck2 --version",
        elapsedMs: 8,
        output: "buck2 0.0.0",
        status: "ok",
      },
    ],
    buildSteps: [
      {
        label: "buck2 build //...",
        command: "buck2 build //...",
        elapsedMs: null,
        output: "skipped (capture disabled)",
        status: "skipped",
      },
    ],
  };
}

async function main() {
  const outPath = getFlagStr("out", "docs/handbook/nix-gaps-baseline.md");
  const mode = getFlagStr("mode", "live");
  const captureBuilds = getFlagBool("capture-builds");

  const isFixture = mode === "fixture";
  const now = isFixture ? fixtureResults().now : new Date().toISOString();
  const repoRoot = process.cwd();

  const gitHead = isFixture
    ? fixtureResults().env.head
    : runCommand("git", ["rev-parse", "HEAD"]).output;
  const gitDirty = isFixture
    ? fixtureResults().env.dirty
    : String(runCommand("git", ["status", "--porcelain"]).output.length > 0);

  const envSummary = isFixture
    ? fixtureResults().env
    : {
        repo: repoRoot,
        platform: os.platform(),
        release: os.release(),
        node: process.version,
        head: gitHead,
        dirty: gitDirty,
      };

  const toolResults = isFixture
    ? fixtureResults().tools
    : [
        runCommand("nix", ["--version"]),
        runCommand("buck2", ["--version"]),
        runCommand("go", ["version"]),
        runCommand("node", ["--version"]),
        runCommand("pnpm", ["--version"]),
        runCommand("python3", ["--version"]),
        runCommand("uv", ["--version"]),
      ];

  const buildSteps = isFixture
    ? fixtureResults().buildSteps
    : [
        captureBuilds
          ? runCommand("buck2", ["build", "//..."])
          : {
              label: "buck2 build //...",
              command: "buck2 build //...",
              elapsedMs: null,
              output: "skipped (run with --capture-builds)",
              status: "skipped",
            },
        captureBuilds
          ? runCommand("buck2", ["test", "//...", "--", "--env", "COVERAGE=1"])
          : {
              label: "buck2 test //... -- --env COVERAGE=1",
              command: "buck2 test //... -- --env COVERAGE=1",
              elapsedMs: null,
              output: "skipped (run with --capture-builds)",
              status: "skipped",
            },
        captureBuilds
          ? runCommand("nix", ["build", ".#graph-generator"])
          : {
              label: "nix build .#graph-generator",
              command: "nix build .#graph-generator",
              elapsedMs: null,
              output: "skipped (run with --capture-builds)",
              status: "skipped",
            },
      ];

  const lines: string[] = [];
  lines.push("# Nix gaps baseline");
  lines.push("");
  lines.push(
    `Generated by \`node --experimental-strip-types --import ./build-tools/tools/dev/zx-init.mjs build-tools/tools/dev/nix-gaps-baseline.ts\` at ${now}.`,
  );
  lines.push("");
  lines.push("## How to refresh");
  lines.push("");
  lines.push(
    "I regenerate this file by running `node --experimental-strip-types --import ./build-tools/tools/dev/zx-init.mjs build-tools/tools/dev/nix-gaps-baseline.ts`.",
  );
  lines.push("");
  lines.push("## Environment summary");
  lines.push("");
  lines.push(`- repo: ${envSummary.repo}`);
  lines.push(`- platform: ${envSummary.platform}`);
  lines.push(`- release: ${envSummary.release}`);
  lines.push(`- node: ${envSummary.node}`);
  lines.push(`- git: ${envSummary.head}`);
  lines.push(`- git_dirty: ${envSummary.dirty}`);
  lines.push("");
  lines.push("## Tool versions");
  lines.push("");
  lines.push(renderCommands(toolResults));
  lines.push("");
  lines.push("## Example build commands");
  lines.push("");
  lines.push("- `buck2 build //...`");
  lines.push("- `buck2 test //... -- --env COVERAGE=1`");
  lines.push("- `nix build .#graph-generator`");
  lines.push("");
  lines.push("## Best-effort timings");
  lines.push("");
  lines.push(renderCommands(buildSteps));
  lines.push("");

  const outAbs = path.isAbsolute(outPath) ? outPath : path.join(repoRoot, outPath);
  await writeIfChanged(outAbs, lines.join("\n"));
  console.log(`wrote ${outAbs}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
