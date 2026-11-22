import { parse as babelParse } from "@babel/parser";
import yaml from "yaml";
import { CodeBlockItem, CodeValidationResult } from "./state";

/**
 * Extracts all fenced code blocks from markdown text with their language tags.
 */
export function extractCodeBlocksFromMarkdown(markdown: string): Array<{ language: string; code: string }> {
  const codeBlockRegex = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
  const blocks: Array<{ language: string; code: string }> = [];
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(markdown)) !== null) {
    const language = (match[1] || "").toLowerCase().trim();
    const code = match[2];
    blocks.push({ language, code });
  }

  return blocks;
}

/**
 * Deterministic AST Syntax Validator.
 * NOTE: AI-generated code is NEVER executed on the host runtime!
 * Static syntax grammar inspection only.
 */
export function validateCodeBlock(language: string, code: string): { isValid: boolean; errors: string[] } {
  const normalizedLang = language.toLowerCase();
  const errors: string[] = [];

  // TypeScript / JavaScript / JSX / TSX
  if (["typescript", "ts", "javascript", "js", "tsx", "jsx"].includes(normalizedLang)) {
    try {
      babelParse(code, {
        sourceType: "module",
        plugins: ["typescript", "jsx", "decorators-legacy", "classProperties"],
      });
      return { isValid: true, errors: [] };
    } catch (err: any) {
      errors.push(`Babel AST Parse Error [line ${err.loc?.line ?? "?"}, col ${err.loc?.column ?? "?"}]: ${err.message}`);
      return { isValid: false, errors };
    }
  }

  // JSON
  if (["json"].includes(normalizedLang)) {
    try {
      JSON.parse(code);
      return { isValid: true, errors: [] };
    } catch (err: any) {
      errors.push(`JSON Parse Error: ${err.message}`);
      return { isValid: false, errors };
    }
  }

  // YAML
  if (["yaml", "yml"].includes(normalizedLang)) {
    try {
      yaml.parse(code);
      return { isValid: true, errors: [] };
    } catch (err: any) {
      errors.push(`YAML Parse Error: ${err.message}`);
      return { isValid: false, errors };
    }
  }

  // Python, Go, Rust, SQL: Structural Integrity Gate (Balanced delimiters and syntax cues)
  if (["python", "py", "go", "golang", "rust", "rs", "sql"].includes(normalizedLang)) {
    const delimiters: Record<string, string> = { "(": ")", "{": "}", "[": "]" };
    const stack: string[] = [];
    const lines = code.split("\n");

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];
      // Skip commented lines
      if (
        (normalizedLang.startsWith("py") && line.trim().startsWith("#")) ||
        (normalizedLang.startsWith("go") && line.trim().startsWith("//")) ||
        (normalizedLang.startsWith("rs") && line.trim().startsWith("//")) ||
        (normalizedLang === "sql" && line.trim().startsWith("--"))
      ) {
        continue;
      }

      for (const char of line) {
        if (delimiters[char]) {
          stack.push(char);
        } else if (Object.values(delimiters).includes(char)) {
          const expectedOpen = Object.keys(delimiters).find((k) => delimiters[k] === char);
          const actualOpen = stack.pop();
          if (actualOpen !== expectedOpen) {
            errors.push(
              `Delimiter Mismatch in ${normalizedLang} snippet at line ${lineIdx + 1}: Expected closing for '${actualOpen}', found '${char}'`
            );
          }
        }
      }
    }

    if (stack.length > 0) {
      errors.push(`Unclosed Delimiters in ${normalizedLang} snippet: Unclosed [${stack.join(", ")}]`);
    }

    return { isValid: errors.length === 0, errors };
  }

  // Default: Unknown or markup languages (e.g. bash, sh, markdown, text, html) - accept with delimiter check
  return { isValid: true, errors: [] };
}

/**
 * Validates all code blocks in an article draft.
 */
export function validateArticleCode(markdown: string): CodeValidationResult {
  const rawBlocks = extractCodeBlocksFromMarkdown(markdown);
  const validatedBlocks: CodeBlockItem[] = [];
  const allSyntaxErrors: string[] = [];

  for (const block of rawBlocks) {
    const result = validateCodeBlock(block.language, block.code);
    validatedBlocks.push({
      language: block.language,
      code: block.code,
      isValid: result.isValid,
      errors: result.errors,
    });

    if (!result.isValid) {
      allSyntaxErrors.push(...result.errors);
    }
  }

  return {
    allValid: allSyntaxErrors.length === 0,
    blocksValidated: rawBlocks.length,
    blocks: validatedBlocks,
    syntaxErrors: allSyntaxErrors,
  };
}
