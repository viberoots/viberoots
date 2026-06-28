import * as fsp from "node:fs/promises";

export async function alignGeneratedWorkspaceFlakeInput(opts: {
  flakeFile: string;
  viberootsSource: string;
  dryRun?: boolean;
}): Promise<"fresh" | "would-repair" | "repaired"> {
  let text = "";
  try {
    text = await fsp.readFile(opts.flakeFile, "utf8");
  } catch {
    return "fresh";
  }

  const desired = `viberoots.url = "path:${opts.viberootsSource}";`;
  const next = text.replace(/viberoots\.url\s*=\s*"(?:path|git\+file):[^"]*";/, desired);
  if (next === text) return "fresh";
  if (opts.dryRun) return "would-repair";

  const tmp = `${opts.flakeFile}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmp, next, "utf8");
  await fsp.rename(tmp, opts.flakeFile);
  return "repaired";
}
