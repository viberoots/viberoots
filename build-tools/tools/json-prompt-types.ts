export type JsonPromptPrimitive = boolean | number | string | null;
export type JsonPromptValue = Exclude<JsonPromptPrimitive, null>;

export type JsonPromptObject = Record<string, JsonPromptPrimitive>;
export type JsonPromptLabels = Record<string, string>;
export type JsonPromptDefaults = Record<string, JsonPromptValue>;
export type JsonPromptFieldType = "string" | "number" | "boolean";
export type JsonPromptNamedArgMode = "pair" | "flag";

export type JsonPromptRequiredWhenRule = {
  if: Record<string, JsonPromptValue>;
  require: string[];
};

export type JsonPromptRuleSet = {
  order?: string[];
  labels?: JsonPromptLabels;
  required?: string[];
  defaults?: JsonPromptDefaults;
  fieldTypes?: Record<string, JsonPromptFieldType>;
  namedArgModes?: Record<string, JsonPromptNamedArgMode>;
  requiredWhen?: JsonPromptRequiredWhenRule[];
  defaultTemplates?: Record<string, string>;
  reservedFlagsAsFields?: Record<string, string>;
};

export type JsonPromptOptions = {
  fieldKeys: string[];
  order: string[];
  labels: JsonPromptLabels;
  defaults: JsonPromptDefaults;
  fieldTypes: Record<string, JsonPromptFieldType>;
  namedArgModes: Record<string, JsonPromptNamedArgMode>;
  required: Set<string>;
  requiredWhen: JsonPromptRequiredWhenRule[];
  defaultTemplates: Record<string, string>;
};

export type JsonPromptResolution =
  | { kind: "set"; value: JsonPromptValue }
  | { kind: "omit" }
  | { kind: "retry"; reason: string };

export type JsonPromptOutputMode = "json" | "named-args";

export type JsonPromptRuntime = {
  interactive?: boolean;
  prompt?: (text: string) => Promise<string>;
  onRetry?: (reason: string) => void;
};

export type JsonPromptRuleSource = {
  optionArgs: string[];
  rulesRaw?: string;
};
