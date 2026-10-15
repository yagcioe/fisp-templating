import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { TypstSnippet } from "@myriaddreamin/typst.ts/contrib/snippet";
import { calculateInvoice, type TemplateEngine } from "../../core.ts";
import { renderZugferdPdf } from "../../zugferd/index.ts";

const require = createRequire(import.meta.url);
const template = await readFile(new URL("./invoice.typ", import.meta.url), "utf8");

const wasm = (pkg: string, file: string) => () =>
  readFile(require.resolve(`@myriaddreamin/${pkg}/pkg/${file}`));

/**
 * typst.ts is browser-first: in Node we have to hand it the WASM binary
 * explicitly. Default fonts are fetched once from jsDelivr during init(),
 * so the first init needs network access. PDF export only needs the compiler;
 * the renderer module is only used for SVG/canvas output.
 */
function createSnippet(): TypstSnippet {
  const typst = new TypstSnippet();
  typst.setCompilerInitOptions({
    getModule: wasm("typst-ts-web-compiler", "typst_ts_web_compiler_bg.wasm"),
  });
  return typst;
}

/** Renders a ZUGFeRD 2.x / Factur-X (EN 16931 profile) PDF/A-3b invoice. */
export function createTypstEngine(): TemplateEngine {
  const typst = createSnippet();
  // The snippet wraps a single WASM compiler instance (main source, inputs);
  // serialize calls so concurrent requests can't interleave.
  let queue: Promise<unknown> = Promise.resolve();

  const run = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = queue.then(fn, fn);
    queue = next.catch(() => {});
    return next;
  };

  return {
    name: "typst",
    async init() {
      await run(async () => {
        await typst.getCompiler();
      });
    },
    render(data) {
      const invoice = calculateInvoice(data);
      return renderZugferdPdf(invoice, "typst.ts", async (xml) => {
        // The template embeds `xml` itself via `pdf.attach`.
        const pdf = await run(() =>
          typst.pdf({ mainContent: template, inputs: { data: JSON.stringify(invoice), xml } }),
        );
        if (!pdf) throw new Error("typst produced no PDF");
        return pdf;
      });
    },
  };
}
