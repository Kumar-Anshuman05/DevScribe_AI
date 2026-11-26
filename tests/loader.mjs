import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const rootDir = process.cwd();

export async function resolve(specifier, context, nextResolve) {
  let resolvedSpecifier = specifier;

  // Handle '@/...' alias
  if (specifier.startsWith("@/")) {
    resolvedSpecifier = path.join(rootDir, "src", specifier.slice(2));
  } else if (specifier.startsWith("./") || specifier.startsWith("../")) {
    if (context.parentURL && context.parentURL.startsWith("file://")) {
      const parentDir = path.dirname(new URL(context.parentURL).pathname.replace(/^\/([A-Z]:)/i, "$1"));
      resolvedSpecifier = path.resolve(parentDir, specifier);
    }
  }

  // Check if resolvedSpecifier is a file path
  if (path.isAbsolute(resolvedSpecifier)) {
    const extensions = ["", ".ts", ".tsx", ".js", ".mjs", ".json", "/index.ts", "/index.js"];
    for (const ext of extensions) {
      const candidate = resolvedSpecifier + ext;
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return {
          shortCircuit: true,
          url: pathToFileURL(candidate).href,
        };
      }
    }
  }

  return nextResolve(specifier, context);
}
