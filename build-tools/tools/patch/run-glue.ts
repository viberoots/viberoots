import { DEFAULT_GRAPH_PATH } from "../lib/graph-const";
import { DEFAULT_AUTO_MAP_PATH } from "../lib/workspace-state-paths";

export async function runGlue(
  opts: {
    workspaceRoot?: string;
    toolSourceRoot?: string;
    env?: NodeJS.ProcessEnv;
    nodeBin?: string;
    buck2Bin?: string;
    nixBin?: string;
  } = {},
): Promise<void> {
  const { runGluePipeline } = await import("../buck/glue-pipeline");
  await runGluePipeline({
    graphPath: DEFAULT_GRAPH_PATH,
    outAutoMap: DEFAULT_AUTO_MAP_PATH,
    ...opts,
  });
}
