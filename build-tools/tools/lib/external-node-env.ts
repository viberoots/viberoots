import { nodeOptionsWithoutZxInit } from "./node-run";

export function externalNodeToolEnv(inherited: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = { ...inherited };
  const nodeOptions = nodeOptionsWithoutZxInit(env.NODE_OPTIONS);
  if (nodeOptions) env.NODE_OPTIONS = nodeOptions;
  else delete env.NODE_OPTIONS;
  return env;
}
