import * as fsp from "node:fs/promises";
import path from "node:path";
import { DEFAULT_GRAPH_PATH } from "../../lib/workspace-state-paths";

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

export async function writeRunnableFixture(
  tmp: string,
  prodOutput: string,
  devOutput = prodOutput,
): Promise<string> {
  const fixtureDir = path.join(tmp, "buck-out", "tmp", "package-label-runnable");
  const prodBin = path.join(fixtureDir, "prod");
  const devBin = path.join(fixtureDir, "dev");
  const manifestPath = path.join(fixtureDir, "manifest.json");
  await fsp.mkdir(fixtureDir, { recursive: true });
  await fsp.writeFile(
    prodBin,
    `#!/usr/bin/env bash\nset -euo pipefail\necho ${JSON.stringify(prodOutput)}\n`,
    "utf8",
  );
  await fsp.writeFile(
    devBin,
    `#!/usr/bin/env bash\nset -euo pipefail\necho ${JSON.stringify(devOutput)}\n`,
    "utf8",
  );
  await Promise.all([fsp.chmod(prodBin, 0o755), fsp.chmod(devBin, 0o755)]);
  await fsp.writeFile(
    manifestPath,
    `${JSON.stringify(
      [
        {
          label: "//projects/apps/demo:app",
          kind: "bin",
          bins: [prodBin],
          aux: [],
          runnable: {
            kind: "native-bin",
            run: {
              prod: { argv: [prodBin] },
              dev: { argv: [devBin] },
            },
            artifacts: { bins: [prodBin] },
          },
        },
      ],
      null,
      2,
    )}\n`,
    "utf8",
  );
  return manifestPath;
}
