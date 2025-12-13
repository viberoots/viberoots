import type { ScafFlags } from "../types.ts";

import { printSkip } from "../../../lib/errors.ts";
import { isLanguageEnabled } from "../language-enablement.ts";
import { readTemplateMeta } from "../templates/meta.ts";
import { printTemplateList } from "../templates/list.ts";

export async function cmdTemplates(args: string[], flags: ScafFlags) {
  const lang = args[0];
  if (lang && !(await isLanguageEnabled(lang))) {
    printSkip("missing-language", `${lang}`);
    return;
  }
  const metas = await readTemplateMeta(lang);
  printTemplateList(metas, flags["json"] === "true");
}
