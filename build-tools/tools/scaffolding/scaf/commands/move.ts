import type { ScafFlags } from "../types";

import path from "node:path";

import * as fsp from "node:fs/promises";

import { confirmOrExit } from "../confirm";
import { exists } from "../fs";
import { usage } from "../usage";

export async function cmdMove(args: string[], flags: ScafFlags) {
  const [oldPath, newPath] = args;
  const yes = flags["yes"] === "true";
  const dry = flags["dry-run"] === "true";
  if (!oldPath || !newPath) {
    usage();
    process.exit(2);
  }
  await confirmOrExit(`Move ${oldPath} -> ${newPath}`, yes, dry);
  await fsp.mkdir(path.dirname(newPath), { recursive: true });
  await fsp.rename(oldPath, newPath);
  const ans = path.join(newPath, ".copier-answers.yml");
  const name = path.basename(newPath);
  if (!(await exists(ans))) {
    await fsp.writeFile(ans, `name: ${name}\n`, "utf8");
  } else {
    let txt = await fsp.readFile(ans, "utf8");
    if (/^name:\s/m.test(txt)) {
      txt = txt.replace(/^name:\s.*$/m, `name: ${name}`);
    } else {
      txt += `\nname: ${name}\n`;
    }
    if (/^module:\s/m.test(txt)) {
      const m = /^module:\s*(\S+)/m.exec(txt)?.[1] || "";
      const parts = m.split("/");
      if (parts.length >= 3) {
        parts[parts.length - 1] = name;
        const newModule = parts.join("/");
        txt = txt.replace(/^module:\s.*$/m, `module: ${newModule}`);
      }
    }
    await fsp.writeFile(ans, txt, "utf8");
  }
  console.log("move OK");
}
