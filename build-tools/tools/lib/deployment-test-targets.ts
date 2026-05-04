import process from "node:process";
import "../dev/zx-init.mjs";
import {
  buckCommandEnv,
  isBuckDaemonInitTransient,
  resolveNestedBuckIsolation,
} from "./buck-command-env";
import { DEPLOYMENT_DOMAIN_LABEL } from "./deployment-verify-scope";
import { targetLabelFromScript } from "./template-owned-tests";

const CONFIG_SUFFIX = /\s+\([^)]*\)$/;

export const DEPLOYMENT_SAFETY_FLOOR_TARGETS = [
  targetLabelFromScript(
    "build-tools/tools/tests/deployments/deployment-domain.file-size-lint.test.ts",
  ),
  targetLabelFromScript(
    "build-tools/tools/tests/deployments/deployment-domain.labels.cquery.test.ts",
  ),
  targetLabelFromScript(
    "build-tools/tools/tests/deployments/deployment-domain.taxonomy-drift.test.ts",
  ),
  targetLabelFromScript(
    "build-tools/tools/tests/deployments/deployment-verify-scope.boundary.test.ts",
  ),
] as const;

function normalizeTarget(target: string): string {
  const clean = String(target || "")
    .trim()
    .replace(CONFIG_SUFFIX, "");
  if (!clean) return "";
  if (clean.startsWith("root//")) return clean.slice("root".length);
  return clean;
}

function toSortedUnique(values: Iterable<string>): string[] {
  return Array.from(new Set(Array.from(values).filter(Boolean))).sort();
}

export async function queryDeploymentDomainTargets(root: string): Promise<string[]> {
  const { isolationDir, ownsIsolation } = resolveNestedBuckIsolation({
    root,
    prefix: "deployment-selector",
  });
  const query = `attrfilter(labels, "${DEPLOYMENT_DOMAIN_LABEL}", //...)`;
  const targetPlatform =
    String(process.env.BUCK_TARGET_PLATFORMS || process.env.BUCK_TARGET_PLATFORM || "").trim() ||
    "prelude//platforms:default";
  const runCquery = async () =>
    await $({
      cwd: root,
      stdio: "pipe",
      reject: false,
      env: buckCommandEnv(),
    })`buck2 --isolation-dir ${isolationDir} cquery --target-platforms ${targetPlatform} ${query} --json --output-attribute name`;
  try {
    let out: any;
    try {
      out = await runCquery();
    } catch (err) {
      if (!isBuckDaemonInitTransient(err instanceof Error ? err.message : String(err))) throw err;
      await new Promise<void>((resolve) => setTimeout(resolve, 150));
      out = await runCquery();
    }
    if ((out as any).exitCode !== 0) {
      const errText = String((out as any).stderr || "");
      if (isBuckDaemonInitTransient(errText)) {
        await new Promise<void>((resolve) => setTimeout(resolve, 150));
        const retryOut = await runCquery();
        if ((retryOut as any).exitCode !== 0) return [];
        const retryRaw = JSON.parse(String((retryOut as any).stdout || "{}")) as Record<
          string,
          { name?: string }
        >;
        return toSortedUnique(Object.keys(retryRaw).map((k) => normalizeTarget(k)));
      }
      return [];
    }
    const raw = JSON.parse(String((out as any).stdout || "{}")) as Record<
      string,
      { name?: string }
    >;
    return toSortedUnique(Object.keys(raw).map((k) => normalizeTarget(k)));
  } finally {
    if (ownsIsolation) {
      await $({
        cwd: root,
        stdio: "ignore",
        reject: false,
        env: buckCommandEnv(),
      })`buck2 --isolation-dir ${isolationDir} kill`;
    }
  }
}
