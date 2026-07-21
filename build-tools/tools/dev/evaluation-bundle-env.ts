import { allDevOverrideEnvNames } from "../lib/dev-override-envs";

const formerEvaluationSelectors = [
  "BUCK_GRAPH_JSON",
  "BUCK_QUERY_ROOTS",
  "BUCK_TARGET",
  "BUCK_TARGET_ATTR",
  "BUCK_TARGET_PLATFORM",
  "BUCK_TEST_SRC",
  "COVERAGE",
  "PLANNER_ONLY_CPP",
  "ROOT_GOMOD2NIX_TOML",
  "WEB_WASM_BACKEND",
  "WORKSPACE_ROOT",
  ...allDevOverrideEnvNames(),
];

export function withoutEvaluationSelectors(source: NodeJS.ProcessEnv): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const [name, value] of Object.entries(source)) {
    if (value !== undefined && !formerEvaluationSelectors.includes(name)) clean[name] = value;
  }
  return clean;
}
