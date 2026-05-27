#!/usr/bin/env zx-wrapper
import { getFlagStr } from "../lib/cli";
import {
  loadManagedDependencyProfile,
  parseManagedDependencyProfile,
} from "./control-plane-managed-dependency-profiles";
import { validateManagedDependencyProfile } from "./control-plane-managed-dependency-validation";
import { redactConfigDiagnostic } from "./control-plane-runtime-config";

export async function runControlPlaneManagedDependenciesCli() {
  const profilePath = getFlagStr("profile");
  const credentialDirectory = getFlagStr("credential-directory");
  if (!profilePath || !credentialDirectory) {
    throw new Error("managed dependency validation requires --profile and --credential-directory");
  }
  const profile = await loadManagedDependencyProfile({ profilePath, credentialDirectory });
  const evidence = await validateManagedDependencyProfile(profile);
  console.log(JSON.stringify(evidence, null, 2));
}

export { parseManagedDependencyProfile, validateManagedDependencyProfile };

if (import.meta.url === `file://${process.argv[1]}`) {
  runControlPlaneManagedDependenciesCli().catch((error) => {
    console.error(`Error: ${redactConfigDiagnostic(String((error as Error)?.message || error))}`);
    process.exit(1);
  });
}
