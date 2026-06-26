import * as fsp from "node:fs/promises";
import path from "node:path";
import { resolveRequestedVerifyScope } from "../dev/verify/requested-scope";
import { parseVerifyExecutionPolicy } from "../dev/verify/remote-policy";
import { summarizeVerifyScopeDecision } from "../dev/verify/selection-output";
import { runVerifyBuckPasses } from "../dev/verify/verify-passes";
import { mkdirWithMacosMetadataExclusion } from "../lib/macos-metadata";

function ciBuckTestTimeoutSecs(): number {
  return Number(process.env.TIMEOUT_SEC || 1200);
}

export async function runCiBuckTestStage(): Promise<void> {
  const root = process.cwd();
  const { selection } = await resolveRequestedVerifyScope({
    root,
    invocationCwd: root,
    args: {
      coverage: false,
      console: "auto",
      targets: ["//..."],
      selector: "default",
      requestedProjects: [],
      explainSelection: false,
    },
  });
  console.log(`[ci] buck-test selection: ${summarizeVerifyScopeDecision(selection)}`);
  if (selection.diagnostics) console.log(JSON.stringify(selection.diagnostics, null, 2));

  const iso = `ci-buck-test-${process.pid}`;
  const analysisDir = path.join(root, "buck-out", "tmp", "ci-buck-test-analysis");
  await mkdirWithMacosMetadataExclusion(path.join(root, "buck-out"));
  await mkdirWithMacosMetadataExclusion(path.join(root, "buck-out", "tmp"));
  await mkdirWithMacosMetadataExclusion(analysisDir);
  const status = await runVerifyBuckPasses({
    root,
    iso,
    logFile: null,
    console: "auto",
    targets: selection.targets,
    zxNodeModulesOut: null,
    analysisDir,
    onPgid: () => {},
    executionPolicy: parseVerifyExecutionPolicy({ coverage: process.env.COVERAGE === "1" }),
    exactOverallTimeoutSecs: ciBuckTestTimeoutSecs(),
  });
  if (status !== 0) process.exit(status);
}
