import type { TemplateEngine } from "./core.ts";
import { createKitaEngine } from "./templates/kitajs.tsx";
import { createTypstEngine } from "./templates/typst/index.ts";

/** Creates all engines and runs their one-time init (WASM, fonts, Chromium) in parallel. */
export async function loadEngines(): Promise<Map<string, TemplateEngine>> {
  const engines = [createKitaEngine(), createTypstEngine()];
  await Promise.all(engines.map((e) => e.init?.()));
  return new Map(engines.map((e) => [e.name, e]));
}
