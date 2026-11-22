const test = require("node:test");
const assert = require("node:assert");
const { parse: babelParse } = require("@babel/parser");
const yaml = require("yaml");

function validateCodeBlock(language, code) {
  const normalizedLang = language.toLowerCase();
  const errors = [];

  if (["typescript", "ts", "javascript", "js", "tsx", "jsx"].includes(normalizedLang)) {
    try {
      babelParse(code, {
        sourceType: "module",
        plugins: ["typescript", "jsx"],
      });
      return { isValid: true, errors: [] };
    } catch (err) {
      errors.push(err.message);
      return { isValid: false, errors };
    }
  }

  if (["json"].includes(normalizedLang)) {
    try {
      JSON.parse(code);
      return { isValid: true, errors: [] };
    } catch (err) {
      errors.push(err.message);
      return { isValid: false, errors };
    }
  }

  if (["yaml", "yml"].includes(normalizedLang)) {
    try {
      yaml.parse(code);
      return { isValid: true, errors: [] };
    } catch (err) {
      errors.push(err.message);
      return { isValid: false, errors };
    }
  }

  // Structural integrity for python/rust
  if (["python", "py", "rust", "rs"].includes(normalizedLang)) {
    const delimiters = { "(": ")", "{": "}", "[": "]" };
    const stack = [];
    for (const char of code) {
      if (delimiters[char]) stack.push(char);
      else if (Object.values(delimiters).includes(char)) {
        const expected = Object.keys(delimiters).find((k) => delimiters[k] === char);
        if (stack.pop() !== expected) {
          errors.push(`Delimiter mismatch for '${char}'`);
        }
      }
    }
    if (stack.length > 0) errors.push("Unclosed delimiters");
    return { isValid: errors.length === 0, errors };
  }

  return { isValid: true, errors: [] };
}

test("AST Validator: Valid TypeScript code parses cleanly", () => {
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
});

test("AST Validator: Detects syntax error in broken JavaScript", () => {
  const brokenJs = `
    function calculate() {
      const x = ; // Syntax error
      return x + 1;
    }
  `;
  const result = validateCodeBlock("javascript", brokenJs);
  assert.strictEqual(result.isValid, false);
  assert.ok(result.errors.length > 0);
});

test("AST Validator: Validates JSON blocks", () => {
  assert.strictEqual(validateCodeBlock("json", '{"name": "DevScribe", "version": "4.3.3"}').isValid, true);
  assert.strictEqual(validateCodeBlock("json", '{"name": "DevScribe", trailing, }').isValid, false);
});

test("AST Validator: Delimiter checks on Python/Rust code", () => {
  const validPython = `def calculate_metrics(items):\n    return [x * 2 for x in items if x > 0]\n`;
  const brokenRust = `fn main() { let x = (1 + 2; println!("{}", x); }`; // unclosed paren

  assert.strictEqual(validateCodeBlock("python", validPython).isValid, true);
  assert.strictEqual(validateCodeBlock("rust", brokenRust).isValid, false);
});
