import * as fsp from "node:fs/promises";
import path from "node:path";

export async function debugListTargets(
  root: string,
  buckProcessEnv: () => NodeJS.ProcessEnv,
): Promise<void> {
  if ((process.env.DEVBUILD_DEBUG || "").trim() !== "1") return;
  try {
    console.warn("[dev-build][debug] listing TARGETS files before export:");
    await $({
      stdio: "inherit",
      cwd: root,
    })`bash --noprofile --norc -c 'find . -name TARGETS -type f | sort | sed -e s,^.,ROOT,'`;
    const demoTargets = path.join(root, "libs", "demo-lib", "TARGETS");
    try {
      const txt = await fsp.readFile(demoTargets, "utf8").catch(() => "");
      if (txt) console.warn("[dev-build][debug] projects/libs/demo-lib/TARGETS contents:\n" + txt);
    } catch {}
    console.warn("[dev-build][debug] running 'buck2 targets //...'");
    await $({ stdio: "inherit", cwd: root, env: buckProcessEnv() })`buck2 targets //...`;
  } catch {}
}
