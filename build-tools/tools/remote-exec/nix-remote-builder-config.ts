export type BuilderPolicy = "inherit_config" | "force_builders_file" | "disabled";

export type SmokeReport = {
  schemaVersion: 1;
  policy: BuilderPolicy;
  effective: Record<string, string>;
  envrcMasksBuilders: boolean;
  commands: string[][];
  diagnostics: string[];
  ok: boolean;
};

const KEYS = ["builders", "substituters", "trusted-public-keys", "max-jobs"];

export function parseNixConfig(text: string): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^([A-Za-z0-9_.-]+)\s*=\s*(.*)$/.exec(trimmed);
    if (match) parsed[match[1]] = match[2].trim();
  }
  return parsed;
}

export function remoteCiToolsPathEnv(
  remoteCiTools: string,
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  if (!remoteCiTools) return baseEnv;
  if (!remoteCiTools.startsWith("/nix/store/")) {
    throw new Error(`remote-ci-tools must be a Nix store path: ${remoteCiTools}`);
  }
  return {
    ...baseEnv,
    PATH: `${remoteCiTools}/bin`,
  };
}

export function relevantNixConfig(text: string): Record<string, string> {
  const parsed = parseNixConfig(text);
  return Object.fromEntries(KEYS.map((key) => [key, parsed[key] || ""]).filter(([, v]) => v));
}

export function envrcMasksBuilders(envrcText: string): boolean {
  return /(^|\n)\s*(export\s+)?NIX_CONFIG=.*builders\s*=\s*(['"]{0,1}\s*['"]{0,1}|\\n)/s.test(
    envrcText,
  );
}

export function buildSmokeReport(input: {
  nixConfigText: string;
  envrcText: string;
  builderUri?: string;
  buildersFile?: string;
  probeBuild?: boolean;
}): SmokeReport {
  const effective = relevantNixConfig(input.nixConfigText);
  const masked = envrcMasksBuilders(input.envrcText);
  const policy = classifyPolicy(effective, input.buildersFile);
  const commands: string[][] = [];
  if (input.builderUri) commands.push(["nix", "store", "info", "--store", input.builderUri]);
  if (input.probeBuild) {
    commands.push([
      "nix",
      "build",
      ".#graph-generator",
      "--no-link",
      "--rebuild",
      "--accept-flake-config",
    ]);
  }
  return {
    schemaVersion: 1,
    policy,
    effective,
    envrcMasksBuilders: masked,
    commands,
    diagnostics: diagnostics(policy, masked, input),
    ok: policy !== "disabled" && !masked,
  };
}

function classifyPolicy(effective: Record<string, string>, buildersFile?: string): BuilderPolicy {
  if (buildersFile) return "force_builders_file";
  if (effective.builders && effective.builders.trim() !== "") return "inherit_config";
  return "disabled";
}

function diagnostics(
  policy: BuilderPolicy,
  masked: boolean,
  input: { builderUri?: string; probeBuild?: boolean },
): string[] {
  const out: string[] = [];
  if (masked) out.push(".envrc appears to mask inherited Nix builders");
  if (policy === "disabled") out.push("builders are intentionally disabled or unset");
  if (policy === "inherit_config") out.push("remote builders are inherited from NIX_CONFIG");
  if (policy === "force_builders_file") out.push("remote builders are forced by generated file");
  if (!input.builderUri)
    out.push("builder store probe skipped because no builder URI was provided");
  if (!input.probeBuild) out.push("probe build skipped because --probe-build was not requested");
  return out;
}
