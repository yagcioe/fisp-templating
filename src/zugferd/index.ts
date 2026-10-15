import type { CalculatedInvoice } from "../models/dto/types.ts";
import { buildCiiXml } from "./cii.ts";
import { finalizeFacturX } from "./pdfa.ts";

/**
 * Shared ZUGFeRD pipeline for all engines: builds the CII XML, lets the engine
 * lay out the visual PDF (it may embed the XML itself) and finishes it as
 * PDF/A-3b Factur-X (EN 16931).
 */
export async function renderZugferdPdf(
  invoice: CalculatedInvoice,
  creator: string,
  renderPdf: (xml: string) => Promise<Uint8Array>,
): Promise<Uint8Array> {
  const xml = buildCiiXml(invoice);
  const pdf = await renderPdf(xml);
  return finalizeFacturX(pdf, xml, {
    title: invoice.title,
    author: invoice.seller.name,
    subject: `Invoice ${invoice.number} for ${invoice.buyer.name}`,
    conformanceLevel: "EN 16931",
    creator,
  });
}
