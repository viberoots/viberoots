#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { sanitizeName } from "../../lib/sanitize";

type Case = {
  target: string;
  importer: string;
};

const cases: Case[] = [
  { target: "//build-tools/tools/tests/lang/importer_strings:dot", importer: "." },
  {
    target: "//build-tools/tools/tests/lang/importer_strings:projects_apps_web",
    importer: "projects/apps/web",
  },
  {
    target: "//build-tools/tools/tests/lang/importer_strings:projects_libs_some_tool",
    importer: "projects/libs/some_tool",
  },
  {
    target: "//build-tools/tools/tests/lang/importer_strings:repeated_slashes_trailing",
    importer: "projects/apps//web/",
  },
];

function displayName(importer: string): string {
  const parts = importer.split("/").filter((p) => p !== "");
  return parts.length > 0 ? parts[parts.length - 1]! : importer;
}

function buckEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: process.env.BUCK2_REAL_HOME || process.env.HOME,
    SSL_CERT_FILE: process.env.SSL_CERT_FILE || process.env.NIX_SSL_CERT_FILE,
  };
}

function isBuckDaemonInitTransient(text: string): boolean {
  const msg = String(text || "");
  return (
    msg.includes("Error initializing DaemonStateData") ||
    msg.includes("Error creating HTTP client") ||
    msg.includes("Error loading system root certificates native frameworks")
  );
}

async function runBuckWithTransientRetry(run: () => Promise<any>): Promise<any> {
  try {
    return await run();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!isBuckDaemonInitTransient(msg)) throw err;
    await new Promise<void>((resolve) => setTimeout(resolve, 150));
    return await run();
  }
}

async function buildAndReadOutput(target: string): Promise<string> {
  const inherited = String(
    process.env.BUCK_ISOLATION_DIR || process.env.BUCK_NESTED_ISO || "",
  ).trim();
  const iso = inherited || `importer_strings_${process.pid}`;
  try {
    await runBuckWithTransientRetry(
      async () => await $({ env: buckEnv() })`buck2 --isolation-dir ${iso} build ${target}`,
    );
    const { stdout } = await runBuckWithTransientRetry(
      async () =>
        await $({ env: buckEnv() })`buck2 --isolation-dir ${iso} targets --show-output ${target}`,
    );
    const out = stdout.trim().split(/\s+/).pop() || "";
    if (!out) throw new Error("no output path for " + target);
    return await fsp.readFile(out, "utf8");
  } finally {
    // Let verify/test harness manage daemon lifecycle; avoid per-test cold-start churn.
  }
}

for (const c of cases) {
  const txt = await buildAndReadOutput(c.target);
  const [sanitized, display] = txt.trimEnd().split("\n");

  const wantSanitized = sanitizeName(c.importer);
  const wantDisplay = displayName(c.importer);

  if (sanitized !== wantSanitized) {
    console.error(
      `sanitize_importer_for_nix_attr mismatch for importer='${c.importer}': starlark='${sanitized}' ts='${wantSanitized}'`,
    );
    process.exit(2);
  }
  if (display !== wantDisplay) {
    console.error(
      `importer_display_name mismatch for importer='${c.importer}': starlark='${display}' ts='${wantDisplay}'`,
    );
    process.exit(2);
  }
}

console.log("OK importer strings probe");
