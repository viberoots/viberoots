#!/usr/bin/env zx-wrapper
import type { Node } from "../types";
import { nodesFromCqueryJson } from "./nodes";
import { runCqueryMerged } from "./runner";

export async function cqueryNodes(scope: string, attrs: string[]): Promise<Node[]> {
  const merged = await runCqueryMerged({ scope, attrs });
  return nodesFromCqueryJson(merged);
}
