import type { CalculatedInvoice } from "../models/dto/types.ts";
import { buildCiiXml } from "./cii.ts";
import { addFacturXMetadata, finalizeFacturX } from "./pdfa.ts";

const CONFORMANCE_LEVEL = "EN 16931";

export type PdfFinishing =
  /** Plain PDF: convert to PDF/A-3b, attach the XML and write all metadata. */
  | { kind: "convert"; creator: string }
  /** Engine already wrote PDF/A-3b with the XML attached and its own metadata; only add the Factur-X fields. */
  | { kind: "native" };

/**
 * Shared ZUGFeRD pipeline for all engines: builds the CII XML, lets the engine
 * lay out the visual PDF (it may embed the XML itself) and finishes it as
 * PDF/A-3b Factur-X (EN 16931).
 */
export async function renderZugferdPdf(
  invoice: CalculatedInvoice,
  finishing: PdfFinishing,
  renderPdf: (xml: string) => Promise<Uint8Array>,
): Promise<Uint8Array> {
  const xml = buildCiiXml(invoice);
  const pdf = await renderPdf(xml);
  if (finishing.kind === "native") return addFacturXMetadata(pdf, CONFORMANCE_LEVEL);
  return finalizeFacturX(pdf, xml, {
    title: invoice.title,
    author: invoice.seller.name,
    subject: `Invoice ${invoice.number} for ${invoice.buyer.name}`,
    conformanceLevel: CONFORMANCE_LEVEL,
    creator: finishing.creator,
  });
}
