export type NixBuilderPolicy = "local_only" | "inherit_config" | "force_builders_file";

export function nixBuilderPolicyArgs(opts: {
  policy: NixBuilderPolicy;
  buildersFile?: string;
}): string[] {
  if (opts.policy === "local_only") return ["--builders", ""];
  if (opts.policy === "inherit_config") return [];
  const buildersFile = String(opts.buildersFile || "").trim();
  if (!buildersFile) {
    throw new Error("force_builders_file requires a generated builders file path");
  }
  return ["--builders", `@${buildersFile}`];
}

export function localOnlyNixBuilderArgs(): string[] {
  return nixBuilderPolicyArgs({ policy: "local_only" });
}

export function nixBuilderPolicyShellArgs(policy: NixBuilderPolicy): string {
  if (policy === "local_only") return '--builders ""';
  if (policy === "inherit_config") return "";
  return '--builders "@${VBR_NIX_BUILDERS_FILE:?force_builders_file requires VBR_NIX_BUILDERS_FILE}"';
}
