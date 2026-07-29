import * as fsp from "node:fs/promises";
import path from "node:path";

type Metric = { total: number; covered: number; skipped: number; pct: number };
type Summary = {
  lines: Metric;
  statements: Metric;
  functions: Metric;
  branches: Metric;
};

function metric(total: number, covered: number): Metric {
  return {
    total,
    covered,
    skipped: 0,
    pct: total === 0 ? 100 : Math.round((covered / total) * 10_000) / 100,
  };
}

function parseRecord(record: string): { file: string; summary: Summary } | null {
  const lines = record.split(/\r?\n/u);
  const file = lines.find((line) => line.startsWith("SF:"))?.slice(3);
  if (!file) return null;
  const lineHits = lines
    .filter((line) => line.startsWith("DA:"))
    .map((line) => Number(line.slice(3).split(",")[1] || 0));
  const functionHits = lines
    .filter((line) => line.startsWith("FNDA:"))
    .map((line) => Number(line.slice(5).split(",")[0] || 0));
  const branchHits = lines
    .filter((line) => line.startsWith("BRDA:"))
    .map((line) => {
      const value = line.split(",")[3] || "-";
      return value === "-" ? 0 : Number(value);
    });
  const linesMetric = metric(lineHits.length, lineHits.filter((hits) => hits > 0).length);
  return {
    file,
    summary: {
      lines: linesMetric,
      statements: linesMetric,
      functions: metric(functionHits.length, functionHits.filter((hits) => hits > 0).length),
      branches: metric(branchHits.length, branchHits.filter((hits) => hits > 0).length),
    },
  };
}

function total(records: readonly Summary[], field: keyof Summary): Metric {
  const count = records.reduce(
    (acc, record) => ({
      total: acc.total + record[field].total,
      covered: acc.covered + record[field].covered,
    }),
    { total: 0, covered: 0 },
  );
  return metric(count.total, count.covered);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export async function publishMergedLcovReport(root: string): Promise<void> {
  const coverageDir = path.join(root, "coverage");
  const lcov = await fsp.readFile(path.join(coverageDir, "lcov.info"), "utf8");
  const records = lcov
    .split(/\nend_of_record\r?\n?/u)
    .map(parseRecord)
    .filter((record): record is NonNullable<typeof record> => record !== null)
    .sort((left, right) => left.file.localeCompare(right.file));
  const summaries = records.map((record) => record.summary);
  const all: Summary = {
    lines: total(summaries, "lines"),
    statements: total(summaries, "statements"),
    functions: total(summaries, "functions"),
    branches: total(summaries, "branches"),
  };
  const json = Object.fromEntries([
    ["total", all],
    ...records.map((record) => [record.file, record.summary]),
  ]);
  await fsp.writeFile(
    path.join(coverageDir, "coverage-summary.json"),
    JSON.stringify(json, null, 2) + "\n",
  );
  const rows = records
    .map(
      ({ file, summary }) =>
        `<tr><td>${escapeHtml(file)}</td><td>${summary.lines.pct}%</td><td>${summary.functions.pct}%</td><td>${summary.branches.pct}%</td></tr>`,
    )
    .join("\n");
  await fsp.writeFile(
    path.join(coverageDir, "index.html"),
    `<!doctype html><meta charset="utf-8"><title>Coverage</title><h1>Merged coverage</h1><p>Lines: ${all.lines.pct}%</p><table><thead><tr><th>File</th><th>Lines</th><th>Functions</th><th>Branches</th></tr></thead><tbody>${rows}</tbody></table>\n`,
  );
}
