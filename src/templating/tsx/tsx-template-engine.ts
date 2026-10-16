import puppeteer, { type Browser } from "puppeteer";
import type { TemplateEngine } from "../template.service.ts";
import type { TsxTemplateDescriptor } from "./tsx-template-descriptor.ts";

export class TsxTemplateEngine implements TemplateEngine {
  #browser: Promise<Browser> | undefined;

  #getBrowser() {
    // PUPPETEER_ARGS passes extra Chromium flags, e.g. "--no-sandbox" in containers.
    const args = process.env.PUPPETEER_ARGS?.split(" ").filter(Boolean);
    return (this.#browser ??= puppeteer.launch({ args }));
  }

  async init() {
    await this.#getBrowser();
  }

  render<TData>(desciptor: TsxTemplateDescriptor<TData>, format: "pdf"): Promise<Uint8Array>;
  render<TData>(desciptor: TsxTemplateDescriptor<TData>, format: "html"): Promise<string>;
  async render<TData>(desciptor: TsxTemplateDescriptor<TData>, format: "pdf" | "html"): Promise<Uint8Array | string> {
    const html = await desciptor.getTemplate(desciptor.data);

    if (format === "html") return html;

    const page = await (await this.#getBrowser()).newPage();
    try {
      await page.setContent(html, { waitUntil: "load" });
      return await page.pdf({ preferCSSPageSize: true, printBackground: true });
    } finally {
      await page.close();
    }
  }

  async close() {
    await (await this.#browser)?.close();
    this.#browser = undefined;
  }
}