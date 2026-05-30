import * as fsp from "node:fs/promises";
import { getFlagStr } from "../lib/cli";
import { validateRunbookBundle } from "./cloud-control-runbook";

export async function runCloudControlSetupDoctorCommand(): Promise<void> {
  const bundleDir = getFlagStr("bundle-dir", ".").trim();
  const out = getFlagStr("out", "").trim();
  const result = await validateRunbookBundle(bundleDir);
  const text = `${JSON.stringify(result, null, 2)}\n`;
  if (out) await fsp.writeFile(out, text, "utf8");
  console.log(text.trimEnd());
  if (!result.ok) process.exitCode = 2;
}
