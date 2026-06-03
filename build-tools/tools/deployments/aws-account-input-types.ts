export type StackInputSource = {
  source: "cli" | "inline" | "default" | "local-values" | "sprinkleref" | "env" | "missing";
  ref?: string;
  category?: string;
  env?: string;
  localValuesPath?: string;
  backend?: string;
  categoryExplicit?: boolean;
  valuePrinted: boolean;
};

export type StackInputResolution = {
  value?: string;
  ref?: string;
  category?: string;
  source: StackInputSource;
  error?: string;
};
