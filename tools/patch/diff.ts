export async function makeUnifiedDiff(srcDir: string, dstDir: string): Promise<string> {
  // Require git --no-index so we get canonical a/ and b/ prefixes; do not fallback.
  const res = await $({
    stdio: "pipe",
  })`git --no-pager diff --no-index -U3 --src-prefix=a/ --dst-prefix=b/ -- ${srcDir} ${dstDir}`.nothrow();
  let s = String(res.stdout || "");
  // If there are no changes, stdout will be empty. Treat that as a clean no-op diff
  // and return an empty string so callers can handle it without failing.
  if (!s) {
    return "";
  }
  // Normalize absolute path bleed-through by simple prefix replacement on headers
  const src = srcDir.replace(/\/+$/, "");
  const dst = dstDir.replace(/\/+$/, "");
  s = s
    // diff header lines
    .replaceAll(` diff --git a${src}/`, " diff --git a/")
    .replaceAll(` diff --git b${dst}/`, " diff --git b/")
    .replaceAll(`diff --git a${src}/`, "diff --git a/")
    .replaceAll(`diff --git b${dst}/`, "diff --git b/")
    // file header lines
    .replaceAll(`--- a${src}/`, "--- a/")
    .replaceAll(`+++ b${dst}/`, "+++ b/")
    .replaceAll(`--- a${dst}/`, "--- a/")
    .replaceAll(`+++ b${src}/`, "+++ b/")
    // generic occurrences
    .replaceAll(`a${src}/`, "a/")
    .replaceAll(`b${dst}/`, "b/");
  return s;
}
