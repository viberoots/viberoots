import type { TemplateMetaRow } from "./meta.ts";

export function printTemplateList(metas: TemplateMetaRow[], json: boolean) {
  if (json) {
    console.log(JSON.stringify(metas, null, 2));
    return;
  }
  metas.forEach((m) => {
    const vars = Array.isArray(m.variables) && m.variables.length ? m.variables.join(",") : "-";
    console.log(`${m.language}\t${m.template}\t${m.description}\t${vars}`);
  });
}
