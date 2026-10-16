import type { TemplateEngine } from "./core.ts";
import { KitaTemplateEngine } from "./tsx/kitajs.ts";
import { TypstTemplateEngine } from "./typst/typst-wasm.ts";

/** Creates all engines and runs their one-time init (WASM + fonts, Chromium) in parallel. */
export async function loadEngines(): Promise<Map<string, TemplateEngine>> {
  const engines: TemplateEngine[] = [new KitaTemplateEngine(), new TypstTemplateEngine()];
  await Promise.all(engines.map((e) => e.init?.()));
  return new Map(engines.map((e) => [e.name, e]));
}
