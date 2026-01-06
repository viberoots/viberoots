import "zx/globals";
import process from "node:process";

export async function runVerifyLintPreflight(root: string): Promise<void> {
  if ((process.env.VERIFY_SKIP_LINT || "").trim() === "1") return;

  const timeoutSecs = Number((process.env.VERIFY_LINT_TIMEOUT_SECS || "600").trim());
  const secs = Number.isFinite(timeoutSecs) && timeoutSecs > 0 ? Math.floor(timeoutSecs) : 600;

  process.stderr.write(`[verify] lint preflight: timeout -k 10s ${secs}s pnpm -s lint\n`);

  const res = await $({
    stdio: "inherit",
    cwd: root,
    reject: false,
  })`timeout -k 10s ${secs}s pnpm -s lint`;
  if (res.exitCode === 0) return;

  process.stderr.write(
    "error: lint preflight failed; refusing to run verify while formatting/lint is dirty\n" +
      "hint: run 'pnpm -s lint:fix' (or format the specific files), then re-run 'v'\n",
  );
  process.exit(2);
}
