import { encode } from "cborg";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createTypstCompiler, type TypstCompiler } from "typst-wasm";
import { createWorkerThread } from "typst-wasm/worker/node";
import type { TemplateEngine } from "../template.service.ts";
import type { TypstTemplateDescriptor } from "./typst-template-descriptor.ts";

const MAIN = "main.typ";
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
 * The template gets the calculated invoice as CBOR via `sys.inputs`. For PDF,
 * the shared pipeline (@e-invoice-eu/core) attaches the CII XML and writes the
 * Factur-X metadata.
 */
export class TypstTemplateEngine implements TemplateEngine {
  #compiler: TypstCompiler | undefined;

  async init() {
    const compiler = await createCompiler();
    await compiler.addFonts(...FONTS.map((font) => packageFile(`@typst-wasm/fonts/${font}`)));

    this.#compiler = compiler;
  }

  get #ready(): TypstCompiler {
    if (!this.#compiler) throw new Error("typst engine used before init()");
    return this.#compiler;
  }

  render<TData>(descriptor: TypstTemplateDescriptor<TData>, format: "pdf"): Promise<Uint8Array>;
  render<TData>(descriptor: TypstTemplateDescriptor<TData>, format: "html"): Promise<string>;
  async render<TData>(descriptor: TypstTemplateDescriptor<TData>, format: "pdf" | "html"): Promise<Uint8Array | string> {

    const cbor = encode(descriptor.data, { ignoreUndefinedProperties: true });
    await this.#ready.addSource(MAIN, await descriptor.getTemplate());
    const path = `inputs/${randomUUID()}.cbor`;
    await this.#ready.addFile(path, cbor);
    try {
      if (format === "html") {
        return (await this.#ready.compile(
          { format: "html", main: MAIN, inputs: { data: path } }
        )).output;
      }

      return (await this.#ready.compile(
        { format: "pdf", main: MAIN, inputs: { data: path }, pdfStandards: ["a3b"], }
      )).output;
    }
    finally {
      await this.#ready.clearFiles()
    }
  }

  async close() {
    await this.#compiler?.dispose();
    this.#compiler = undefined;
  }
}
