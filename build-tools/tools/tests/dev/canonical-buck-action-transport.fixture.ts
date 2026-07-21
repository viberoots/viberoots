import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { canonicalArtifactToolsRoot } from "../../lib/artifact-environment";

export const artifactToolsRoot = canonicalArtifactToolsRoot(process.cwd());
export const canonicalNode = path.join(artifactToolsRoot, "bin", "node");

export async function buckTransportFixture(): Promise<{
  root: string;
  graph: string;
  manifest: string;
  stateRoot: string;
  marker: string;
  artifactMarker: string;
}> {
  const root = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "buck-transport-")));
  const graph = path.join(root, "graph.json");
  const stateRoot = path.join(root, "action-state");
  const manifest = path.join(stateRoot, "declared-inputs.txt");
  const artifactMarker = path.join(stateRoot, "artifact-tools-root");
  const marker = path.join(root, ".viberoots", "workspace", "buck", "workspace-root.env");
  await fsp.mkdir(stateRoot);
  await fsp.mkdir(path.dirname(marker), { recursive: true });
  await fsp.writeFile(graph, "[]\n");
  await fsp.writeFile(marker, "# derived from declared input\n");
  await fsp.writeFile(artifactMarker, `${artifactToolsRoot}\n`);
  await fsp.writeFile(manifest, `${artifactMarker}\n${graph}\n${marker}\n`);
  return { root, graph, manifest, stateRoot, marker, artifactMarker };
}
