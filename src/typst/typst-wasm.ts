import { readFile } from "node:fs/promises";
import { createTypstCompiler, type TypstCompiler } from "typst-wasm";
import { createWorkerThread } from "typst-wasm/worker/node";
import { calculateInvoice, type TemplateEngine } from "../core.ts";
import type { InvoiceData } from "../models/dto/types.ts";
import { renderZugferdPdf } from "../zugferd/index.ts";

const MAIN = "main.typ";
const template = await readFile(new URL("./templates/invoice.typ", import.meta.url), "utf8");

/** Reads a file shipped in a package (WASM modules, fonts) via its export path. */
const packageFile = (specifier: string) => readFile(new URL(import.meta.resolve(specifier)));

/** Font faces the template uses; bundled locally, so no network access is needed. */
const FONTS = ["LibertinusSerif-Regular.otf", "LibertinusSerif-Bold.otf", "LibertinusSerif-Italic.otf"];

const createCompiler = () =>
  createTypstCompiler({
    backend: "worker",
    coreModules: {
      "engine.core.wasm": packageFile("typst-wasm/engine/engine.core.wasm").then(WebAssembly.compile),
      "engine.core2.wasm": packageFile("typst-wasm/engine/engine.core2.wasm").then(WebAssembly.compile),
      "engine.core3.wasm": packageFile("typst-wasm/engine/engine.core3.wasm").then(WebAssembly.compile),
    },
    worker: () => createWorkerThread(new URL(import.meta.resolve("typst-wasm/worker/worker-thread"))),
  });

/**
 * Renders the invoice with typst (typst-wasm, compiled in a worker thread).
 * The template gets the calculated invoice as JSON and, for PDF, the CII XML
 * via `sys.inputs`; it embeds the XML itself with `pdf.attach` and sets the
 * document metadata. typst writes PDF/A-3b natively; the shared pipeline only
 * adds the Factur-X XMP fields, which typst cannot express.
 */
export class TypstTemplateEngine implements TemplateEngine {
  readonly name = "typst";
  #compiler: TypstCompiler | undefined;

  async init() {
    const compiler = await createCompiler();
    await compiler.addFonts(...FONTS.map((font) => packageFile(`@typst-wasm/fonts/${font}`)));
    await compiler.addSource(MAIN, template);
    this.#compiler = compiler;
  }

  get #ready(): TypstCompiler {
    if (!this.#compiler) throw new Error("typst engine used before init()");
    return this.#compiler;
  }

  render(data: InvoiceData, format: "pdf"): Promise<Uint8Array>;
  render(data: InvoiceData, format: "html"): Promise<string>;
  async render(data: InvoiceData, format: "pdf" | "html"): Promise<Uint8Array | string> {
    const invoice = calculateInvoice(data);
    const json = JSON.stringify(invoice);

    if (format === "html") {
      return (await this.#ready.compile({ format: "html", main: MAIN, inputs: { data: json } })).output;
    }
    // typst writes PDF/A-3b, the attachment and all document metadata itself (see
    // the template); only the Factur-X XMP fields are added afterwards.
    return renderZugferdPdf(invoice, { kind: "native" }, async (xml) => {
      const result = await this.#ready.compile({
        format: "pdf",
        main: MAIN,
        inputs: { data: json, xml },
        pdfStandards: ["a3b"],
      });
      return result.output;
    });
  }

  async close() {
    await this.#compiler?.dispose();
    this.#compiler = undefined;
  }
}
