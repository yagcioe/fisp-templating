// `puppeteer` (not `puppeteer-core`): only it knows the Chrome it downloaded.
import puppeteer, { type Browser } from "puppeteer";
import { calculateInvoice, type TemplateEngine } from "../core.ts";
import type { InvoiceData } from "../models/dto/types.ts";
import { renderZugferdPdf } from "../zugferd/index.ts";
import { toHtml } from "./templates/invoice.tsx";

/**
 * Renders the invoice as HTML with Kita. For PDF the HTML is printed with
 * headless Chromium (Puppeteer) and finished as the same ZUGFeRD / Factur-X
 * PDF/A-3b as the typst engine produces.
 */
export class KitaTemplateEngine implements TemplateEngine {
  readonly name = "kitajs";
  #browser: Promise<Browser> | undefined;

  #getBrowser() {
    // PUPPETEER_ARGS passes extra Chromium flags, e.g. "--no-sandbox" in containers.
    const args = process.env.PUPPETEER_ARGS?.split(" ").filter(Boolean);
    return (this.#browser ??= puppeteer.launch({ args }));
  }

  async init() {
    await this.#getBrowser();
  }

  render(data: InvoiceData, format: "pdf"): Promise<Uint8Array>;
  render(data: InvoiceData, format: "html"): Promise<string>;
  async render(data: InvoiceData, format: "pdf" | "html"): Promise<Uint8Array | string> {
    const invoice = calculateInvoice(data);
    if (format === "html") return toHtml(invoice);

    return renderZugferdPdf(invoice, { kind: "convert", creator: "Kita HTML + Chromium" }, async () => {
      const page = await (await this.#getBrowser()).newPage();
      try {
        await page.setContent(toHtml(invoice), { waitUntil: "load" });
        return await page.pdf({ preferCSSPageSize: true, printBackground: true });
      } finally {
        await page.close();
      }
    });
  }

  async close() {
    await (await this.#browser)?.close();
    this.#browser = undefined;
  }
}