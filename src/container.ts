import type { Cradle } from "@fastify/awilix";
import { asClass, type AwilixContainer, createContainer, InjectionMode, Lifetime } from "awilix";
import { InvoiceService } from "./invoice/invoice.service.ts";
import { TemplateService } from "./templating/template.service.ts";

/** Everything the DI container provides; resolved by name, e.g. `app.diContainer.resolve("invoiceService")`. */
declare module "@fastify/awilix" {
  interface Cradle {
    templateService: TemplateService;
    invoiceService: InvoiceService;
  }
}

/**
 * Creates the app's DI container. PROXY mode: each class gets the cradle as
 * its only constructor argument and destructures the dependencies it needs.
 * One container per app, so separate app instances (e.g. in tests) never share
 * services.
 */
export function createAppContainer(): AwilixContainer<Cradle> {
  const container = createContainer<Cradle>({ injectionMode: InjectionMode.PROXY, strict: true });
  container.register({
    // Engines are warmed up (WASM + fonts, Chromium) when the app starts and
    // closed with it; @fastify/awilix runs these hooks on ready / close.
    templateService: asClass(TemplateService, { lifetime: Lifetime.SINGLETON, asyncInit: "init", asyncDispose: "close" }),
    invoiceService: asClass(InvoiceService, { lifetime: Lifetime.SINGLETON }),
  });
  return container;
}
