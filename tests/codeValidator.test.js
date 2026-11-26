const test = require("node:test");
const assert = require("node:assert");

// Import actual production code validator directly from src/lib/agents/codeValidator
let validateCodeBlock;
let validateArticleCode;
let extractCodeBlocksFromMarkdown;

test.before(async () => {
  const mod = await import("@/lib/agents/codeValidator");
  validateCodeBlock = mod.validateCodeBlock;
  validateArticleCode = mod.validateArticleCode;
  extractCodeBlocksFromMarkdown = mod.extractCodeBlocksFromMarkdown;
});

test("AST Validator (Production Module): Valid TypeScript code parses cleanly with BABEL_AST", () => {
  const validTs = `
    import { useState } from 'react';
    interface Props { count: number; }
    export const Counter: React.FC<Props> = ({ count }) => {
      const [val, setVal] = useState(count);
      return <button onClick={() => setVal(val + 1)}>Count: {val}</button>;
    };
  `;
  const result = validateCodeBlock("typescript", validTs);
  assert.strictEqual(result.isValid, true);
  assert.strictEqual(result.errors.length, 0);
  assert.strictEqual(result.validationType, "BABEL_AST");
});

test("AST Validator (Production Module): Detects syntax error in broken JavaScript", () => {
  const brokenJs = `
    function calculate() {
      const x = ; // Syntax error
      return x + 1;
    }
  `;
  const result = validateCodeBlock("javascript", brokenJs);
  assert.strictEqual(result.isValid, false);
  assert.ok(result.errors.length > 0);
  assert.strictEqual(result.validationType, "BABEL_AST");
});

test("AST Validator (Production Module): Validates JSON blocks with JSON_PARSE", () => {
  const validJson = validateCodeBlock("json", '{"name": "DevScribe", "version": "4.3.3"}');
  assert.strictEqual(validJson.isValid, true);
  assert.strictEqual(validJson.validationType, "JSON_PARSE");

  const brokenJson = validateCodeBlock("json", '{"name": "DevScribe", trailing, }');
  assert.strictEqual(brokenJson.isValid, false);
  assert.strictEqual(brokenJson.validationType, "JSON_PARSE");
});

test("AST Validator (Production Module): Validates YAML blocks with YAML_PARSE", () => {
  const validYaml = validateCodeBlock("yaml", "name: DevScribe\nversion: 4.3.3\nfeatures:\n  - AI\n  - Agents");
  assert.strictEqual(validYaml.isValid, true);
  assert.strictEqual(validYaml.validationType, "YAML_PARSE");

  const brokenYaml = validateCodeBlock("yaml", "name: [broken yaml: {unclosed");
  assert.strictEqual(brokenYaml.isValid, false);
  assert.strictEqual(brokenYaml.validationType, "YAML_PARSE");
});

test("AST Validator (Production Module): Delimiter structural check on Python/Rust code (DELIMITER_CHECK_ONLY)", () => {
  const validPython = `def calculate_metrics(items):\n    return [x * 2 for x in items if x > 0]\n`;
  const brokenRust = `fn main() { let x = (1 + 2; println!("{}", x); }`; // unclosed paren

  const pyResult = validateCodeBlock("python", validPython);
  assert.strictEqual(pyResult.isValid, true);
  assert.strictEqual(pyResult.validationType, "DELIMITER_CHECK_ONLY");

  const rustResult = validateCodeBlock("rust", brokenRust);
  assert.strictEqual(rustResult.isValid, false);
  assert.strictEqual(rustResult.validationType, "DELIMITER_CHECK_ONLY");
});

test("AST Validator (Production Module): Full article markdown code block extraction and validation", () => {
  const sampleMarkdown = `
# Building High-Performance Services

Here is our configuration:
\`\`\`json
{
  "port": 8080,
  "service": "api-gateway"
}
\`\`\`

Here is our main handler:
\`\`\`typescript
export function startServer(port: number): void {
  console.log("Listening on " + port);
}
\`\`\`
  `;

  const result = validateArticleCode(sampleMarkdown);
  assert.strictEqual(result.allValid, true);
  assert.strictEqual(result.blocksValidated, 2);
  assert.strictEqual(result.blocks[0].validationType, "JSON_PARSE");
  assert.strictEqual(result.blocks[1].validationType, "BABEL_AST");
});
