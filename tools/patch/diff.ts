export async function makeUnifiedDiff(srcDir: string, dstDir: string): Promise<string> {
  // Prefer git diff --no-index for consistent headers; fallback to diff -ruN
  try {
    const { stdout } =
      await $`git --no-pager diff --no-index -U3 --src-prefix=a/ --dst-prefix=b/ -- ${srcDir} ${dstDir}`;
    return String(stdout || "");
  } catch {}
  try {
    const { stdout } = await $`diff -ruN ${srcDir} ${dstDir}`;
    return String(stdout || "");
  } catch (e) {
    // diff returns non-zero when differences exist; capture stdout from thrown error if available
    const out = (e as any)?.stdout || (e as any)?.message || "";
    return String(out);
  }
}
