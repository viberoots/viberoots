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
cat > "$PATTERNS_FILE" <<'EOF_PAT'
${PATTERNS_VALUE}
EOF_PAT

FOUND=0
if find . \
  -path "./node_modules" -prune -o \
  -path "./dist" -prune -o \
  -path "./build" -prune -o \
  -path "./.vite" -prune -o \
  -type f \( -name "*.test.ts" -o -name "*.test.js" \) -print -quit | grep -q .; then
  FOUND=1
fi

COVERAGE_ARGS=""
if [ "${COVERAGE_ENV}" = "1" ]; then
  export NODE_V8_COVERAGE="coverage/raw"
  COVERAGE_ARGS="--coverage --coverage.provider=v8 --coverage.reporter=lcov --coverage.reporter=json-summary --coverage.reporter=html --coverage.reportsDirectory=coverage"
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

  ln -s "${NM_PATH}/node_modules" node_modules
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

    VITEST_TIMEOUT_SECS=420
    if [ "$(basename "$VITEST_BIN")" = "vitest" ]; then
      timeout -k 15s ${VITEST_TIMEOUT_SECS}s "$VITEST_BIN" run \
        --pool forks \
        --maxWorkers 1 \
        --minWorkers 1 \
        --no-file-parallelism \
        --config "$VITE_CFG" \
        --reporter=junit \
        --outputFile=report/junit.xml \
        --passWithNoTests \
        $COVERAGE_ARGS
    else
      timeout -k 15s ${VITEST_TIMEOUT_SECS}s node "$VITEST_BIN" run \
        --pool forks \
        --maxWorkers 1 \
        --minWorkers 1 \
        --no-file-parallelism \
        --config "$VITE_CFG" \
        --reporter=junit \
        --outputFile=report/junit.xml \
        --passWithNoTests \
        $COVERAGE_ARGS
    fi

    if [ ! -s report/junit.xml ]; then
      echo "[nix] junit reporter did not emit a file; writing minimal placeholder" >&2
      echo "<testsuites/>" > report/junit.xml
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


