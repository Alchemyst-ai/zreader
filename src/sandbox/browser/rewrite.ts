/**
 * Turns a piece of JavaScript into the body of an async function that a Kernel
 * runs, so that it behaves like a REPL:
 *
 * - top-level `const`, `let`, `var`, functions and classes stay defined for
 *   later runs, and can be declared again;
 * - the value of a final expression is returned;
 * - `await` and `import` work at the top level.
 *
 * Declarations become assignments to undeclared names, which a sloppy-mode
 * function puts on the Kernel's global object. Runs on the reader's page with
 * acorn, which is passed in so it loads only when JavaScript first runs.
 */
import type * as Acorn from "acorn";

type AcornModule = Pick<typeof Acorn, "parse">;
type AnyNode = Acorn.Node & Record<string, unknown>;
interface Edit {
  start: number;
  end: number;
  text: string;
}

function importText(node: AnyNode, src: string): string {
  const source = src.slice((node.source as AnyNode).start, (node.source as AnyNode).end);
  const specs = node.specifiers as AnyNode[];
  if (!specs.length) return `await import(${source});`;
  const ns = specs.find((s) => s.type === "ImportNamespaceSpecifier");
  const parts: string[] = [];
  const named: string[] = [];
  for (const s of specs) {
    const local = (s.local as AnyNode).name as string;
    if (s.type === "ImportDefaultSpecifier") named.push(`default: ${local}`);
    else if (s.type === "ImportSpecifier") {
      const imported = s.imported as AnyNode;
      const name = imported.type === "Literal" ? JSON.stringify(imported.value) : (imported.name as string);
      named.push(name === local ? local : `${name}: ${local}`);
    }
  }
  if (ns) parts.push(`${(ns.local as AnyNode).name as string} = await import(${source});`);
  if (named.length) parts.push(`;({ ${named.join(", ")} } = await import(${source}));`);
  return parts.join(" ");
}

export function rewriteJavaScript(code: string, acorn: AcornModule): string {
  let program: AnyNode;
  try {
    program = acorn.parse(code, { ecmaVersion: "latest", sourceType: "module", allowAwaitOutsideFunction: true, allowHashBang: true }) as unknown as AnyNode;
  } catch (err) {
    const e = err as Error & { loc?: { line: number; column: number } };
    throw new SyntaxError(e.message.replace(/ \(\d+:\d+\)$/, "") + (e.loc ? ` (line ${e.loc.line}, column ${e.loc.column + 1})` : ""));
  }
  const edits: Edit[] = [];
  const hoisted: string[] = [];
  const body = program.body as AnyNode[];

  body.forEach((stmt0, i) => {
    let stmt = stmt0;
    // `export` means nothing in a Kernel: keep what it declares, drop the rest.
    if (stmt.type === "ExportNamedDeclaration" && !stmt.declaration) {
      edits.push({ start: stmt.start, end: stmt.end, text: "" });
      return;
    }
    if (stmt.type === "ExportAllDeclaration") {
      edits.push({ start: stmt.start, end: stmt.end, text: importText({ ...stmt, specifiers: [] } as AnyNode, code) });
      return;
    }
    if (stmt.type === "ExportNamedDeclaration" || stmt.type === "ExportDefaultDeclaration") {
      const decl = stmt.declaration as AnyNode;
      const named = (decl.type === "FunctionDeclaration" || decl.type === "ClassDeclaration") && decl.id;
      if (stmt.type === "ExportDefaultDeclaration" && !named && decl.type !== "VariableDeclaration") {
        // `export default <expression>` (or an anonymous function/class): keep it as a value.
        edits.push({ start: stmt.start, end: stmt.end, text: `;(${code.slice(decl.start, decl.end)});` });
        return;
      }
      edits.push({ start: stmt.start, end: decl.start, text: "" });
      stmt = decl;
    }
    if (stmt.type === "VariableDeclaration") {
      const decls = stmt.declarations as AnyNode[];
      const parts = decls.map((d) => {
        const id = code.slice((d.id as AnyNode).start, (d.id as AnyNode).end);
        const init = d.init ? code.slice((d.init as AnyNode).start, (d.init as AnyNode).end) : "undefined";
        return `${id} = ${init}`;
      });
      edits.push({ start: stmt.start, end: decls.at(-1)!.end, text: `;(${parts.join(", ")})` });
    } else if (stmt.type === "FunctionDeclaration" && stmt.id) {
      // Function declarations are hoisted: publish them before anything runs.
      const name = (stmt.id as AnyNode).name as string;
      hoisted.push(`globalThis[${JSON.stringify(name)}] = ${name};`);
    } else if (stmt.type === "ClassDeclaration" && stmt.id) {
      const name = (stmt.id as AnyNode).name as string;
      edits.push({ start: stmt.start, end: stmt.start, text: `${name} = ` }, { start: stmt.end, end: stmt.end, text: ";" });
    } else if (stmt.type === "ImportDeclaration") {
      edits.push({ start: stmt.start, end: stmt.end, text: importText(stmt, code) });
    } else if (stmt.type === "ExpressionStatement" && i === body.length - 1 && !stmt.directive) {
      const expr = stmt.expression as AnyNode;
      edits.push({ start: stmt.start, end: stmt.end, text: `return (${code.slice(expr.start, expr.end)});` });
    }
  });

  let out = code;
  for (const e of edits.sort((a, b) => b.start - a.start || b.end - a.end)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return hoisted.join("\n") + (hoisted.length ? "\n" : "") + out;
}
