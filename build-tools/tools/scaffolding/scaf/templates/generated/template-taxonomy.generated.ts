// GENERATED FILE — DO NOT EDIT.
// Rendered from build-tools/tools/scaffolding/template-manifest.json

export const TEMPLATE_NAME_ALIASES: Record<string, string> = {
  "cli-app": "cli",
  "library": "lib",
  "ts-go-cpp-lib": "go-cpp-lib",
};

export const TEMPLATE_TAXONOMY = {
  "cpp": ["cli", "lib"],
  "deployment": [
    "opentofu-foundation",
    "opentofu-provisioner",
    "service",
    "shared",
    "vercel-next",
  ],
  "go": ["cli", "lib"],
  "language": ["kit"],
  "python": [
    "app",
    "lib",
    "wasm-app",
    "wasm-lib",
  ],
  "ts": [
    "cli",
    "cpp-addon",
    "go-addon",
    "go-cpp-lib",
    "lib",
    "service",
    "wasm-app",
    "wasm-inline",
    "wasm-linking-app",
    "webapp-ssr-next",
    "webapp-ssr-vite",
    "webapp-static",
    "webapp-static-pwa",
  ],
} as const;
