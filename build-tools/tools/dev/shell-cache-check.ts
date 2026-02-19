#!/usr/bin/env zx-wrapper
import fs from "fs-extra";

type CheckResult = {
  ok: boolean;
  message: string;
};

function ok(message: string): CheckResult {
  return { ok: true, message };
}

function fail(message: string): CheckResult {
  return { ok: false, message };
}

async function checkEnvrcContract(): Promise<CheckResult[]> {
  const txt = await fs.readFile(".envrc", "utf8");
  const out: CheckResult[] = [];
  out.push(
    txt.includes('source "${__nix_direnv_direnvrc}"')
      ? ok(".envrc loads nix-direnv direnvrc")
      : fail('.envrc must source "${__nix_direnv_direnvrc}"'),
  );
  out.push(
    txt.includes("use flake")
      ? ok(".envrc uses flake via nix-direnv")
      : fail(".envrc must contain `use flake`"),
  );
  out.push(
    txt.includes("error: nix-direnv is required for this repository shell cache path.")
      ? ok(".envrc exposes explicit missing nix-direnv failure")
      : fail(".envrc must expose explicit missing nix-direnv failure text"),
  );
  return out;
}

function checkNixDirenvInstall(): CheckResult {
  const candidates = [
    `${process.env.HOME || ""}/.nix-profile/share/nix-direnv/direnvrc`,
    "/nix/var/nix/profiles/default/share/nix-direnv/direnvrc",
  ].filter(Boolean);
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return ok(`nix-direnv direnvrc found: ${p}`);
    }
  }
  return fail(
    "nix-direnv direnvrc not found in standard profiles (install with `nix profile install nixpkgs#nix-direnv`)",
  );
}

function checkDirenvCacheState(): CheckResult {
  if (!fs.existsSync(".direnv")) {
    return fail(
      ".direnv/flake-profile is missing (run `direnv allow` once, then `direnv reload` to populate cache)",
    );
  }
  const entries = fs.readdirSync(".direnv");
  const hasFlakeProfile = entries.some(
    (e) => e === "flake-profile" || e.startsWith("flake-profile-"),
  );
  if (!hasFlakeProfile) {
    return fail(
      ".direnv/flake-profile is missing (run `direnv allow` once, then `direnv reload` to populate cache)",
    );
  }
  return ok(".direnv/flake-profile(-*) exists (cached dev shell profile present)");
}

async function main() {
  const checks: CheckResult[] = [
    ...(await checkEnvrcContract()),
    checkNixDirenvInstall(),
    checkDirenvCacheState(),
  ];

  let failed = 0;
  for (const c of checks) {
    const prefix = c.ok ? "ok" : "fail";
    if (!c.ok) failed++;
    console.log(`[${prefix}] ${c.message}`);
  }

  if (failed > 0) {
    console.error(
      "shell-cache-check failed. If cache looks stale, run: rm -rf .direnv && direnv allow && direnv reload",
    );
    process.exit(1);
  }

  console.log("shell-cache-check: OK");
}

main().catch((error) => {
  console.error(String((error as any)?.stack || error));
  process.exit(1);
});
