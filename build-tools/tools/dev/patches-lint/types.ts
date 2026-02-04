export type PatchesLintFormat = "text" | "json";

export type PatchesLintLang = "" | "go" | "node" | "cpp" | "python";

export type PatchesLintConfig = {
  strict: boolean;
  lang: PatchesLintLang;
  format: PatchesLintFormat;
};

export type Violation = {
  level: "warn" | "error";
  message: string;
  code: string;
  lang: string;
  file?: string;
  moduleKey?: string;
};
