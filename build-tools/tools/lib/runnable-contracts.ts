export const SSR_FRAMEWORKS = ["express", "next", "hatch"] as const;

function readArtifactPath(artifacts: Record<string, unknown> | undefined, key: string): string {
  const value = artifacts?.[key];
  return typeof value === "string" ? value.trim() : "";
}

export function validateSsrRunnableContract(
  target: string,
  contract: {
    framework?: string;
    run: { prod: { argv: string[] }; dev?: { argv: string[] } };
    artifacts?: Record<string, unknown>;
  },
): string[] {
  const errs: string[] = [];
  const framework = String(contract.framework || "").trim();
  if (!SSR_FRAMEWORKS.includes(framework as (typeof SSR_FRAMEWORKS)[number])) {
    errs.push(
      `missing/invalid framework; expected one of ${SSR_FRAMEWORKS.join("|")}, got "${framework || "<empty>"}"`,
    );
  }

  const serverEntry = readArtifactPath(contract.artifacts, "serverEntry");
  const clientDir = readArtifactPath(contract.artifacts, "clientDir");
  if (!serverEntry) errs.push("missing artifacts.serverEntry");
  if (!clientDir) errs.push("missing artifacts.clientDir");

  const prod = Array.isArray(contract.run?.prod?.argv) ? contract.run.prod.argv : [];
  if (prod.length < 2 || prod[0] !== "node") {
    errs.push(`run.prod.argv must start with "node <serverEntry>"; got ${JSON.stringify(prod)}`);
  } else if (serverEntry && prod[1] !== serverEntry) {
    errs.push(
      `run.prod argv/serverEntry mismatch; expected second argv "${serverEntry}", got "${prod[1]}"`,
    );
  }

  if (prod[0] === "python3") {
    errs.push("SSR prod command must not use static host fallback (python http.server)");
  }

  if (errs.length > 0) {
    return errs.map((e) => `SSR contract error for ${target}: ${e}`);
  }
  return errs;
}
