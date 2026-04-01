set -euo pipefail

cd "$IMPORTER_DIR"
export SOURCE_DATE_EPOCH=1

if [ -n "${HAS_NATIVE:-}" ]; then
  mkdir -p native
  if [ -n "${ADDON_SRC:-}" ] && [ -f "${ADDON_SRC:-}" ]; then
    cp -f "${ADDON_SRC}" "native/${ADDON_NAME}.node" 2>/dev/null || true
  fi
fi

VITEST_BIN=""
PATTERNS_FILE="$TMPDIR/patterns.txt"
PATTERN_ARGS_FILE="$TMPDIR/pattern-args.txt"
node -e '
const raw = process.env.PATTERNS_VALUE ?? "\"\"";
const parsed = JSON.parse(raw);
if (typeof parsed !== "string") {
  throw new Error("PATTERNS_VALUE must decode to a string");
}
process.stdout.write(parsed.replace(/\r\n/g, "\n"));
' > "$PATTERNS_FILE"

node -e '
const fs = require("node:fs");
const input = fs.readFileSync(process.argv[1], "utf8");
const out = input
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => JSON.stringify(line))
  .join("\n");
if (out.length > 0) {
  fs.writeFileSync(process.argv[2], `${out}\n`);
} else {
  fs.writeFileSync(process.argv[2], "");
}
' "$PATTERNS_FILE" "$PATTERN_ARGS_FILE"

FOUND=0
MATCHED_TESTS_FILE="$TMPDIR/matched-tests.txt"
if find . \
  -path "./node_modules" -prune -o \
  -path "./dist" -prune -o \
  -path "./build" -prune -o \
  -path "./.vite" -prune -o \
  -type f \( -name "*.test.ts" -o -name "*.test.tsx" -o -name "*.test.js" \) -print -quit | grep -q .; then
  FOUND=1
fi
find . \
  -path "./node_modules" -prune -o \
  -path "./dist" -prune -o \
  -path "./build" -prune -o \
  -path "./.vite" -prune -o \
  -type f \( -name "*.test.ts" -o -name "*.test.tsx" -o -name "*.test.js" \) -print \
  | LC_ALL=C sort > "$MATCHED_TESTS_FILE"

COVERAGE_ARGS=()
if [ "${COVERAGE_ENV}" = "1" ]; then
  export NODE_V8_COVERAGE="coverage/raw"
  COVERAGE_ARGS=(
    --coverage
    --coverage.provider=v8
    --coverage.reporter=lcov
    --coverage.reporter=json-summary
    --coverage.reporter=html
    --coverage.reportsDirectory=coverage
  )
fi

mkdir -p report
if [ "$FOUND" -eq 0 ]; then
  echo "[nix] no tests matched; skipping runner and passing." >&2
else
  if [ -z "${NM_PATH}" ]; then
    echo "[nix] ERROR: tests matched patterns but ${IMPORTER_DIR}/pnpm-lock.yaml is missing." >&2
    echo "[nix] Generate and commit a lockfile (or disable tests) so vitest can be installed deterministically." >&2
    exit 3
  fi

  NM_TARGET="${NM_PATH}/node_modules"
  if [ -L node_modules ] && [ "$(readlink node_modules)" = "$NM_TARGET" ]; then
    :
  else
    rm -rf node_modules
    ln -s "$NM_TARGET" node_modules
  fi
  if [ -x "node_modules/.bin/vitest" ] || [ -f "node_modules/.bin/vitest" ]; then
    VITEST_BIN="node_modules/.bin/vitest"
  else
    VITEST_BIN=$(find node_modules -path "*/node_modules/vitest/*" -type f \( -name "vitest.mjs" -o -name "vitest.js" \) -print -quit 2>/dev/null || true)
  fi
  if [ -z "$VITEST_BIN" ] || [ ! -e "$VITEST_BIN" ]; then
    echo "[nix] DEBUG: vitest binary not found; listing node_modules for diagnostics" >&2
    (find node_modules -maxdepth 3 -type d -print | sort | head -n 200) || true
  fi

  if [ -n "$VITEST_BIN" ]; then
    VITEST_NODE_MODULES=$(dirname "$VITEST_BIN")/..
    NODE_PATH_SUFFIX=""
    if [ -n "$NODE_PATH" ]; then NODE_PATH_SUFFIX=":"$NODE_PATH; fi
    export NODE_PATH="$VITEST_NODE_MODULES$NODE_PATH_SUFFIX"

    VITE_CFG="$TMPDIR/bnx-vite-config.mjs"
    cat > "$VITE_CFG" <<'EOF_VITE_CFG'
export default {
  cacheDir: ".vite",
  optimizeDeps: { disabled: true },
};
EOF_VITE_CFG

    echo "[nix] DEBUG pwd: $(pwd)" >&2
    echo "[nix] DEBUG vitest bin: $VITEST_BIN" >&2
    (ls -la "$VITEST_BIN" || true) >&2
    (command -v node || true) >&2
    echo "[nix] running vitest (coverage=${COVERAGE_ENV:-0})..." >&2

    export VITEST_JUNIT_OUTPUT="report/junit.xml"
    export CI=1
    export VITEST_WATCH=false
    export NODE_OPTIONS="--max-old-space-size=1536 ${NODE_OPTIONS:-}"

    VITEST_TIMEOUT_SECS="${TEST_NIX_TIMEOUT_SECS:-${VERIFY_TIMEOUT_SECS:-${NIX_PNPM_INSTALL_TIMEOUT:-1800}}}"
    mapfile -t PATTERN_ARGS < <(node -e '
const fs = require("node:fs");
const file = process.argv[1];
if (!fs.existsSync(file)) {
  process.exit(0);
}
const lines = fs
  .readFileSync(file, "utf8")
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean);
for (const line of lines) {
  process.stdout.write(`${JSON.parse(line)}\n`);
}
' "$PATTERN_ARGS_FILE")
    MATCHED_TEST_COUNT="$(wc -l < "$MATCHED_TESTS_FILE" | tr -d '[:space:]')"
    echo "[nix] importer=${IMPORTER_DIR} matched_test_files=${MATCHED_TEST_COUNT} timeout=${VITEST_TIMEOUT_SECS}s" >&2
    if [ "${#PATTERN_ARGS[@]}" -gt 0 ]; then
      echo "[nix] importer=${IMPORTER_DIR} pattern_args=${PATTERN_ARGS[*]}" >&2
    else
      echo "[nix] importer=${IMPORTER_DIR} pattern_args=<all-tests>" >&2
    fi
    if [ -s "$MATCHED_TESTS_FILE" ]; then
      echo "[nix] importer=${IMPORTER_DIR} matched_tests_preview:" >&2
      sed -n '1,20p' "$MATCHED_TESTS_FILE" >&2
    fi
    if [ "$(basename "$VITEST_BIN")" = "vitest" ]; then
      set +e
      timeout -k 15s ${VITEST_TIMEOUT_SECS}s "$VITEST_BIN" run \
        --pool forks \
        --maxWorkers 1 \
        --minWorkers 1 \
        --no-file-parallelism \
        --config "$VITE_CFG" \
        --reporter=junit \
        --outputFile=report/junit.xml \
        --passWithNoTests \
        "${COVERAGE_ARGS[@]}" \
        "${PATTERN_ARGS[@]}"
      VITEST_STATUS=$?
      set -e
    else
      set +e
      timeout -k 15s ${VITEST_TIMEOUT_SECS}s node "$VITEST_BIN" run \
        --pool forks \
        --maxWorkers 1 \
        --minWorkers 1 \
        --no-file-parallelism \
        --config "$VITE_CFG" \
        --reporter=junit \
        --outputFile=report/junit.xml \
        --passWithNoTests \
        "${COVERAGE_ARGS[@]}" \
        "${PATTERN_ARGS[@]}"
      VITEST_STATUS=$?
      set -e
    fi

    if [ ! -s report/junit.xml ]; then
      echo "[nix] junit reporter did not emit a file; writing minimal placeholder" >&2
      echo "<testsuites/>" > report/junit.xml
    fi

    if [ "${VITEST_STATUS:-0}" -ne 0 ]; then
      echo "[nix] vitest exited with status ${VITEST_STATUS}; failing testcases:" >&2
      node - <<'EOF_JUNIT_SUMMARY' report/junit.xml >&2 || true
const fs = require("node:fs");
const file = process.argv[2];
const xml = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
const decode = (text) =>
  String(text || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
const cases = Array.from(
  xml.matchAll(/<testcase\b([^>]*)>([\s\S]*?)<\/testcase>|<testcase\b([^>]*)\/>/g),
);
let printed = 0;
for (const match of cases) {
  const attrs = match[1] || match[3] || "";
  const body = match[2] || "";
  if (!/<failure\b|<error\b/.test(body)) continue;
  const name = decode((attrs.match(/\bname="([^"]*)"/) || [])[1] || "<unnamed>");
  const classname = decode((attrs.match(/\bclassname="([^"]*)"/) || [])[1] || "");
  const failure = body.match(/<(failure|error)\b([^>]*)>([\s\S]*?)<\/\1>/);
  const message = decode((failure?.[2].match(/\bmessage="([^"]*)"/) || [])[1] || "");
  const details = decode(String(failure?.[3] || "").replace(/<[^>]+>/g, " "));
  const label = classname ? `${classname} :: ${name}` : name;
  const suffix = message || details ? ` -- ${message || details}` : "";
  console.error(`[nix]   FAIL ${label}${suffix}`);
  printed += 1;
}
if (printed === 0) {
  console.error("[nix]   (no junit failure details found)");
}
EOF_JUNIT_SUMMARY
      exit "${VITEST_STATUS}"
    fi

    if [ "${COVERAGE_ENV}" = "1" ]; then
      if [ ! -s coverage/lcov.info ] || [ ! -s coverage/coverage-summary.json ]; then
        echo "[nix] ERROR: coverage requested but expected reports were not produced (lcov.info / coverage-summary.json)" >&2
        (ls -la coverage || true) >&2
        exit 3
      fi
    fi
  else
    echo "[nix] ERROR: vitest not found under node_modules, but tests matched patterns. Add vitest to devDependencies." >&2
    exit 3
  fi
fi
