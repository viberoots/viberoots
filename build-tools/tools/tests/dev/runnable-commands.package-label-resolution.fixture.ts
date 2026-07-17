import * as fsp from "node:fs/promises";
import path from "node:path";
import { envWithResolvedNixBin, resolveToolPathSync } from "../../lib/tool-paths";
import { DEFAULT_GRAPH_PATH } from "../../lib/workspace-state-paths";

const realNixBin = resolveToolPathSync("nix", envWithResolvedNixBin(process.env));

const demoTarget = {
  name: "//projects/apps/demo:app",
  rule_type: "node_asset_stage",
  labels: [
    "lang:node",
    "kind:app",
    "webapp:ssr",
    "framework:vite",
    "lockfile:projects/apps/demo/pnpm-lock.yaml#projects/apps/demo",
  ],
  srcs: ["projects/apps/demo/src/entry-server.ts"],
  deps: [],
};

export async function writeDemoGraph(tmp: string, targets: unknown[] = [demoTarget]) {
  const graphPath = path.join(tmp, DEFAULT_GRAPH_PATH);
  await fsp.mkdir(path.dirname(graphPath), { recursive: true });
  await fsp.writeFile(graphPath, JSON.stringify(targets, null, 2) + "\n", "utf8");
}

export async function writeSelectedNixStub(tmp: string, targetLog: string, successOutput: string) {
  const stubBin = path.join(tmp, "stub-bin");
  const fakeOut = path.join(tmp, "fake-selected-out");
  await fsp.mkdir(stubBin, { recursive: true });
  await fsp.writeFile(
    path.join(stubBin, "nix"),
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      'args="$*"',
      'if [[ "$args" == flake\\ prefetch\\ --json\\ --no-use-registries\\ --option\\ flake-registry\\ \\ path:* ]] || [[ "$args" == store\\ add-path\\ --name\\ viberoots-evaluation-bundle\\ * ]]; then',
      `  exec ${JSON.stringify(realNixBin)} "$@"`,
      "fi",
      'bundle="${args#*path:}"',
      'bundle="${bundle%%\\?dir=*}"',
      `echo "$bundle" >> ${JSON.stringify(targetLog)}`,
      `out=${JSON.stringify(fakeOut)}`,
      'mkdir -p "$out/bin"',
      "cat > \"$out/bin/demo\" <<'EOF'",
      "#!/usr/bin/env bash",
      `echo ${successOutput}`,
      "EOF",
      'chmod +x "$out/bin/demo"',
      'echo "$out"',
      "",
    ].join("\n"),
    "utf8",
  );
  await fsp.chmod(path.join(stubBin, "nix"), 0o755);
  return stubBin;
}

export async function writePnpmCwdStub(tmp: string, stubBin: string, output: string) {
  const tmpReal = await fsp.realpath(tmp).catch(() => tmp);
  await fsp.writeFile(
    path.join(stubBin, "pnpm"),
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      `if [[ "$PWD" != ${JSON.stringify(tmp)} && "$PWD" != ${JSON.stringify(tmpReal)} ]]; then`,
      '  echo "unexpected-cwd:$PWD" >&2',
      "  exit 98",
      "fi",
      `echo ${output}`,
      "",
    ].join("\n"),
    "utf8",
  );
  await fsp.chmod(path.join(stubBin, "pnpm"), 0o755);
}

export async function selectedTargets(bundleLog: string): Promise<string[]> {
  const bundlePaths = String(await fsp.readFile(bundleLog, "utf8"))
    .split(/\n+/)
    .map((entry) => entry.trim())
    .filter((entry) => /^\/nix\/store\/[a-z0-9]{32}-viberoots-evaluation-bundle$/.test(entry));
  return await Promise.all(
    bundlePaths.map(async (bundlePath) => {
      const selection = JSON.parse(
        await fsp.readFile(path.join(bundlePath, "selection.json"), "utf8"),
      ) as { target?: string };
      return selection.target || "";
    }),
  );
}
