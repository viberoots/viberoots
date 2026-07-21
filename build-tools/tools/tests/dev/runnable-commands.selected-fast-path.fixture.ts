import * as fsp from "node:fs/promises";
import path from "node:path";

export const selectedFastPathTarget = "//projects/apps/demo:demo";

export async function prepareSelectedFastPathFixture(
  tmp: string,
  options: { withProjectFiles?: boolean; withPackageJson?: boolean } = {},
) {
  const projectDir = path.join(tmp, "projects", "apps", "demo");
  await fsp.mkdir(projectDir, { recursive: true });
  if (options.withProjectFiles) {
    await fsp.mkdir(path.join(projectDir, "src"), { recursive: true });
    if (options.withPackageJson) {
      await fsp.writeFile(
        path.join(projectDir, "package.json"),
        '{"name":"selected-fast-demo","scripts":{}}\n',
        "utf8",
      );
    }
    await fsp.writeFile(path.join(projectDir, "src", "index.ts"), "console.log('ok');\n", "utf8");
    await fsp.writeFile(path.join(projectDir, "NEW_UNTRACKED.txt"), "untracked\n", "utf8");
  }
  const command = `${options.withProjectFiles ? 'test -f "$SRCDIR/NEW_UNTRACKED.txt"; ' : ""}printf '#!%s\\necho selected-prod-ok\\n' "$BASH" > "$OUT"; chmod +x "$OUT"`;
  await fsp.writeFile(
    path.join(projectDir, "TARGETS"),
    [
      'load("@prelude//:rules.bzl", "genrule")',
      "",
      "genrule(",
      '    name = "demo",',
      '    out = "demo",',
      `    cmd = ${JSON.stringify(command)},`,
      "    labels = [",
      '        "lang:node",',
      '        "kind:bin",',
      '        "lockfile:projects/apps/demo/pnpm-lock.yaml#projects/apps/demo",',
      "    ],",
      ")",
      "",
    ].join("\n"),
    "utf8",
  );

  return { projectDir };
}
