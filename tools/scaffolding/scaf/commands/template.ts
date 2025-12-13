import path from "node:path";

import * as fsp from "node:fs/promises";

import { exists } from "../fs.ts";
import { usage } from "../usage.ts";

export async function cmdTemplate(args: string[]) {
  const [language, tmpl] = args;
  if (!language || !tmpl) {
    usage();
    process.exit(2);
  }
  const dir = path.join("tools", "scaffolding", "templates", language, tmpl);
  if (await exists(dir)) {
    console.error("template already exists");
    process.exit(2);
  }
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(
    path.join(dir, "meta.json"),
    JSON.stringify(
      {
        language,
        template: tmpl,
        description: `${language} ${tmpl}`,
        help: {
          usage: `scaf new ${language} ${tmpl} <name> [--path=DEST]`,
          notes: [
            `A minimal ${language} ${tmpl} template.`,
            "Variables: name (scaffold name), language, template",
          ],
          examples: [`scaf new ${language} ${tmpl} demo`],
        },
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  await fsp.writeFile(
    path.join(dir, "README.md.jinja"),
    `# {{ name }} (${language} ${tmpl})\n`,
    "utf8",
  );
  console.log("created template:", dir);
}
