export function normalizeTemplateName(name: string): string {
  if (name === "lib" || name === "library") {
    return "lib";
  }
  if (name === "cli-app" || name === "cli") {
    return "cli";
  }
  if (name === "ts-go-cpp-lib") {
    return "go-cpp-lib";
  }
  return name;
}
