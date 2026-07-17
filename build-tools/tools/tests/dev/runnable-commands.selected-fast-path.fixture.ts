import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { envWithResolvedNixBin, resolveToolPathSync } from "../../lib/tool-paths";

const realNixBin = resolveToolPathSync("nix", envWithResolvedNixBin(process.env));

export const selectedFastPathTarget = "//projects/apps/demo:demo";

export function evaluationBundlePath(nixLog: string): string {
  const bundle = nixLog.match(
    /path:(\/nix\/store\/[a-z0-9]{32}-viberoots-evaluation-bundle)\?dir=source(?:\/[^ #?]+)?#graph-generator-selected/,
  )?.[1];
  assert.ok(bundle, `expected immutable evaluation bundle in Nix log: ${nixLog}`);
  return bundle;
}

export async function prepareSelectedFastPathFixture(
  tmp: string,
  options: { withProjectFiles?: boolean; withPackageJson?: boolean } = {},
) {
  const graphDir = path.join(tmp, ".viberoots", "workspace", "buck");
  const projectDir = path.join(tmp, "projects", "apps", "demo");
  await fsp.mkdir(graphDir, { recursive: true });
  if (options.withProjectFiles) {
    await fsp.mkdir(path.join(projectDir, "src"), { recursive: true });
    if (options.withPackageJson) {
      await fsp.writeFile(path.join(projectDir, "package.json"), '{"scripts":{}}\n', "utf8");
    }
    await fsp.writeFile(path.join(projectDir, "src", "index.ts"), "console.log('ok');\n", "utf8");
    await fsp.writeFile(path.join(projectDir, "NEW_UNTRACKED.txt"), "untracked\n", "utf8");
  }
  await fsp.writeFile(
    path.join(graphDir, "graph.json"),
    JSON.stringify(
      [
        {
          name: selectedFastPathTarget,
          rule_type: "nix_node_cli_bin",
          labels: [
            "lang:node",
            "kind:bin",
            "lockfile:projects/apps/demo/pnpm-lock.yaml#projects/apps/demo",
          ],
          srcs: ["projects/apps/demo/src/index.ts"],
          deps: [],
        },
      ],
      null,
      2,
    ) + "\n",
    "utf8",
  );

  const stubBin = path.join(tmp, "stub-bin");
  const fakeOut = path.join(tmp, "fake-selected-out");
  const nixLog = path.join(tmp, "nix-args.log");
  await fsp.mkdir(stubBin, { recursive: true });
  await fsp.writeFile(
    path.join(stubBin, "nix"),
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      `echo "$*" >> ${JSON.stringify(nixLog)}`,
      'args="$*"',
      'if [[ "$args" == flake\\ prefetch\\ --json\\ --no-use-registries\\ --option\\ flake-registry\\ \\ path:* ]] || [[ "$args" == store\\ add-path\\ --name\\ viberoots-evaluation-bundle\\ * ]]; then',
      `  exec ${JSON.stringify(realNixBin)} "$@"`,
      "fi",
      `out=${JSON.stringify(fakeOut)}`,
      'if [[ "$args" == *"graph-generator-selected"* ]]; then',
      '  mkdir -p "$out/bin"',
      "  cat > \"$out/bin/demo\" <<'EOF'",
      "#!/usr/bin/env bash",
      "echo selected-prod-ok",
      "EOF",
      '  chmod +x "$out/bin/demo"',
      '  echo "$out"',
      "  exit 0",
      "fi",
      'if [[ "$args" == *"graph-generator"* ]]; then',
      '  echo "full graph-generator should not be called" >&2',
      "  exit 91",
      "fi",
      'echo "unexpected nix invocation: $args" >&2',
      "exit 92",
      "",
    ].join("\n"),
    "utf8",
  );
  await fsp.chmod(path.join(stubBin, "nix"), 0o755);
  return { nixLog, projectDir, stubBin };
}
