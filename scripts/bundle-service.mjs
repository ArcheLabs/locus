#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const [rootArg, outputArg] = process.argv.slice(2);
if (!rootArg || !outputArg) throw new Error("usage: bundle-service.mjs <locus-root> <temporary-project>");
const root = path.resolve(rootArg);
const output = path.resolve(outputArg);
const adapterEntry = fileURLToPath(import.meta.resolve(
  "@jamscript/client/ownership/matrix/service",
  pathToFileURL(path.join(root, "package.json")).href,
));
const adapterDir = path.dirname(adapterEntry);
const packageRoot = path.resolve(adapterDir, "../../..");
const adapterFiles = [
  path.join(packageRoot, "src/ownership/matrix/proof-runtime.ts"),
  path.join(packageRoot, "src/ownership/matrix/service-payload.ts"),
  path.join(packageRoot, "src/ownership/matrix/service-scriptc.ts"),
];

function inlineModule(file, { stripExports = false, removeAdapterImport = false } = {}) {
  const original = readFileSync(file, "utf8");
  const scriptKind = file.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const source = ts.createSourceFile(file, original, ts.ScriptTarget.Latest, true, scriptKind);
  const edits = [];
  const visit = node => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const specifier = node.moduleSpecifier;
      const isAdapterImport = ts.isStringLiteral(specifier)
        && specifier.text === "@jamscript/client/ownership/matrix/service-scriptc";
      if (stripExports || (removeAdapterImport && isAdapterImport)) {
        edits.push([node.getFullStart(), node.end, ""]);
      }
    }
    if (stripExports && ts.canHaveModifiers(node)) {
      for (const modifier of ts.getModifiers(node) ?? []) {
        if (modifier.kind === ts.SyntaxKind.ExportKeyword) edits.push([modifier.getStart(source), modifier.end, ""]);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  let text = original;
  for (const [start, end, replacement] of edits.sort((a, b) => b[0] - a[0])) {
    text = text.slice(0, start) + replacement + text.slice(end);
  }
  return text;
}

await fs.rm(output, { recursive: true, force: true });
await fs.mkdir(path.join(output, "src"), { recursive: true });
await fs.mkdir(path.join(output, ".jamscript"), { recursive: true });
await fs.mkdir(path.join(output, "deps"), { recursive: true });
await fs.mkdir(path.join(output, "abi"), { recursive: true });

for (const relative of ["jamscript.toml", ".jamscript/service.json", "deps/jamscript.lock", "abi/service.abi.json"]) {
  await fs.copyFile(path.join(root, relative), path.join(output, relative));
}

const adapter = [
  ...adapterFiles.map(file => inlineModule(file, { stripExports: true })),
].join("\n\n");
const source = inlineModule(path.join(root, "src/service.ts"), { removeAdapterImport: true });
await fs.writeFile(path.join(output, "src/service.ts"), `${adapter}\n\n${source}`, "utf8");
console.log("LOCUS_OWNERSHIP_ADAPTER_BUNDLE=PASS");
