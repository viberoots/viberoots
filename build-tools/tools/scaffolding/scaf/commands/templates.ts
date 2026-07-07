import type { ScafFlags } from "../types";

import { printSkip } from "../../../lib/errors";
import { isLanguageEnabled } from "../language-enablement";
import { readTemplateMeta } from "../templates/meta";
import { printTemplateList } from "../templates/list";

export async function cmdTemplates(args: string[], flags: ScafFlags) {
  const lang = args[0];
  if (lang && !(await isLanguageEnabled(lang))) {
    printSkip("missing-language", `${lang}`);
    return;
  }
  const metas = await readTemplateMeta(lang, { tolerateStaleTaxonomy: true });
  printTemplateList(metas, {
    json: flags["json"] === "true",
    details: flags["details"] === "true" || flags["verbose"] === "true",
  });
}
