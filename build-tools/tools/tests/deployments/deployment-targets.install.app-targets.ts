import * as fsp from "node:fs/promises";
import path from "node:path";
import type { ReviewedDeployment } from "./deployment-targets.install.fragments";
import {
  ensureParentDir,
  labelDir,
  labelName,
  uniqueBy,
} from "./deployment-targets.install.fragments";
import { renderStringList } from "./deployment-targets.install.render";

export async function installAppTargetsForDeployments(
  workspaceRoot: string,
  deployments: ReviewedDeployment[],
): Promise<void> {
  const components = uniqueBy(
    deployments.flatMap((deployment) => deployment.components),
    (component) => component.target,
  );
  await Promise.all(
    components.map(async (component) => {
      const targetPath = path.join(workspaceRoot, labelDir(component.target), "TARGETS");
      const framework =
        component.kind === "ssr-webapp" && "runtimeContract" in component.runtime
          ? component.runtime.runtimeContract.framework
          : "";
      const labels =
        component.kind === "ssr-webapp"
          ? ["kind:app", "webapp:ssr", `framework:${framework || "vite"}`]
          : ["kind:app", "webapp:static"];
      await ensureParentDir(targetPath);
      await fsp.writeFile(
        targetPath,
        [
          'load("@prelude//:rules.bzl", "genrule")',
          "",
          "genrule(",
          `    name = ${JSON.stringify(labelName(component.target))},`,
          `    out = ${JSON.stringify(`${labelName(component.target)}.txt`)},`,
          `    cmd = ${JSON.stringify(`printf ${labelName(component.target)} > $OUT`)},`,
          `    labels = ${renderStringList(labels)},`,
          '    visibility = ["PUBLIC"],',
          ")",
          "",
        ].join("\n"),
        "utf8",
      );
    }),
  );
}
