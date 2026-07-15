const staticInputAssignments = [
  'nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";',
  'nixpkgs_23_11.url = "github:NixOS/nixpkgs/nixos-23.11";',
  'buck2.url = "github:facebook/buck2/201beb86106fecdc84e30260b0f1abb5bf576988";',
  'gomod2nix.url = "github:nix-community/gomod2nix";',
  'gomod2nix.inputs.nixpkgs.follows = "nixpkgs";',
] as const;

export function workspaceFlakeInputs(viberootsUrl: string): string {
  const assignments = [
    ...staticInputAssignments,
    `viberoots.url = "${viberootsUrl}";`,
    'viberoots.inputs.nixpkgs.follows = "nixpkgs";',
    'viberoots.inputs.buck2.follows = "buck2";',
    'viberoots.inputs.gomod2nix.follows = "gomod2nix";',
  ];
  return ["  inputs = {", ...assignments.map((line) => `    ${line}`), "  };"].join("\n");
}

function nixCodeMask(text: string): string {
  const chars = [...text];
  let state: "code" | "comment" | "block-comment" | "string" | "indented-string" = "code";
  for (let index = 0; index < chars.length; index += 1) {
    const pair = `${chars[index]}${chars[index + 1] ?? ""}`;
    if (state === "comment") {
      if (chars[index] === "\n") state = "code";
      else chars[index] = " ";
    } else if (state === "block-comment") {
      chars[index] = chars[index] === "\n" ? "\n" : " ";
      if (pair === "*/") {
        chars[index + 1] = " ";
        index += 1;
        state = "code";
      }
    } else if (state === "string") {
      const escaped = chars[index] === "\\";
      const closing = chars[index] === '"';
      chars[index] = chars[index] === "\n" ? "\n" : " ";
      if (escaped && index + 1 < chars.length) {
        chars[index + 1] = chars[index + 1] === "\n" ? "\n" : " ";
        index += 1;
      } else if (closing) state = "code";
    } else if (state === "indented-string") {
      chars[index] = chars[index] === "\n" ? "\n" : " ";
      if (pair === "''") {
        chars[index + 1] = " ";
        index += 1;
        state = "code";
      }
    } else if (chars[index] === "#") {
      chars[index] = " ";
      state = "comment";
    } else if (pair === "/*") {
      chars[index] = " ";
      chars[index + 1] = " ";
      index += 1;
      state = "block-comment";
    } else if (pair === "''") {
      chars[index] = " ";
      chars[index + 1] = " ";
      index += 1;
      state = "indented-string";
    } else if (chars[index] === '"') {
      chars[index] = " ";
      state = "string";
    }
  }
  return chars.join("");
}

export function assertCanonicalWorkspaceFlakeInputs(text: string, viberootsUrl: string): void {
  const expected = workspaceFlakeInputs(viberootsUrl);
  const first = text.indexOf(expected);
  if (first < 0 || text.indexOf(expected, first + expected.length) >= 0) {
    throw new Error("post-clone workspace flake does not contain its unique canonical input block");
  }
  const mask = nixCodeMask(text);
  const opening = "  inputs = {";
  const rootOutputsAuthority = "\n\n  outputs = inputs:";
  const depth = [...mask.slice(0, first)].reduce(
    (value, char) => value + (char === "{" ? 1 : char === "}" ? -1 : 0),
    0,
  );
  if (
    mask.slice(first, first + opening.length) !== opening ||
    depth !== 1 ||
    text.indexOf(rootOutputsAuthority) !== first + expected.length
  ) {
    throw new Error("post-clone workspace flake input block is not a direct top-level assignment");
  }
}
