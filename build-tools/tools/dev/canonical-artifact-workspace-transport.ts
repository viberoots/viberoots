import fs from "node:fs";
import path from "node:path";

export function artifactWorkspaceRootTransport(
  argv: readonly string[],
  fallback: string,
): { argv: string[]; workspaceRoot: string; transportArg: string } {
  const remaining: string[] = [];
  const values: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || "");
    if (arg === "--artifact-workspace-root") values.push(String(argv[++index] || ""));
    else if (arg.startsWith("--artifact-workspace-root=")) values.push(arg.slice(26));
    else remaining.push(arg);
  }
  if (values.length > 1 || values.some((value) => !value)) {
    throw new Error("canonical artifact ingress requires one non-empty workspace-root transport");
  }
  const declared = path.resolve(values[0] || fallback);
  if (fs.realpathSync(declared) !== declared) {
    throw new Error("canonical artifact workspace root must be a physical absolute path");
  }
  return {
    argv: remaining,
    workspaceRoot: declared,
    transportArg: `--artifact-workspace-root=${declared}`,
  };
}
