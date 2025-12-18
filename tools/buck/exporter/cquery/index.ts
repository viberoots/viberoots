#!/usr/bin/env zx-wrapper
import type { Node } from "../types.ts";
import { nodesFromCqueryJson } from "./nodes.ts";
import { runCqueryMerged } from "./runner.ts";

export async function cqueryNodes(scope: string, attrs: string[]): Promise<Node[]> {
  const merged = await runCqueryMerged({ scope, attrs });
  return nodesFromCqueryJson(merged);
}
