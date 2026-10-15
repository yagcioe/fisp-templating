import type { CalculatedInvoice, CalculatedLine, InvoiceData, VatBreakdown } from "./models/dto/types.ts";

/** Common contract all template engines implement: invoice in, ZUGFeRD PDF out. */
export interface TemplateEngine {
  readonly name: string;
  /** Optional one-time warm-up (e.g. loading WASM, launching a browser). */
  init?(): Promise<void>;
  render(data: InvoiceData): Promise<Uint8Array>;
  /** Optional cleanup (e.g. closing a browser). */
  close?(): Promise<void>;
}

/** Thrown for business-rule violations; Fastify maps `statusCode` to the response. */
export class InvoiceValidationError extends Error {
  readonly statusCode = 400;
}

export const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

const unitLabels: Record<string, string> = {
  C62: "pcs",
  H87: "pcs",
  HUR: "h",
  DAY: "d",
  WEE: "wk",
  MON: "mo",
  ANN: "yr",
  KGM: "kg",
  MTR: "m",
  LTR: "l",
  LS: "lump sum",
};

/** Applies the EN 16931 calculation rules and checks the rules the schema can't express. */
export function calculateInvoice(data: InvoiceData): CalculatedInvoice {
  const fail = (rule: string, msg: string) => {
    throw new InvoiceValidationError(`${rule}: ${msg}`);
  };

  if (data.lines.length === 0) fail("BR-16", "an invoice needs at least one line");
  // BR-CO-26 accepts the seller identifier (BT-29), legal registration id
  // (BT-30) or VAT id (BT-31); of these the model only has the VAT id. A tax
  // number (BT-32) alone is not enough.
  if (!data.seller.vatId) fail("BR-CO-26", "seller needs a VAT id");

  const lines = data.lines.map((line, i): CalculatedLine => {
    if (line.vatCategory !== "S" && line.vatRate !== 0) {
      fail(`BR-${line.vatCategory}-05`, `line ${i + 1}: category ${line.vatCategory} requires a VAT rate of 0`);
    }
    if (line.vatCategory === "S" && line.vatRate <= 0) {
      fail("BR-S-05", `line ${i + 1}: category S requires a VAT rate > 0`);
    }
    return {
      ...line,
      id: String(i + 1),
      netAmount: round2(line.quantity * line.unitPrice),
      unitLabel: unitLabels[line.unitCode] ?? line.unitCode,
    };
  });

  const groups = new Map<string, VatBreakdown>();
  for (const line of lines) {
    const key = `${line.vatCategory}:${line.vatRate}`;
    const group = groups.get(key) ?? { category: line.vatCategory, rate: line.vatRate, basisAmount: 0, taxAmount: 0 };
    group.basisAmount = round2(group.basisAmount + line.netAmount);
    groups.set(key, group);
  }
  const vat = [...groups.values()].map((g) => {
    if ((g.category === "E" || g.category === "AE") && !data.vatExemptionReason) {
      fail(`BR-${g.category}-10`, `category ${g.category} requires vatExemptionReason`);
    }
    if (g.category === "AE" && !data.buyer.vatId) fail("BR-AE-02", "reverse charge requires the buyer VAT id");
    return {
      ...g,
      taxAmount: round2((g.basisAmount * g.rate) / 100),
      exemptionReason: g.category === "E" || g.category === "AE" ? data.vatExemptionReason : undefined,
    };
  });

  const lineTotal = round2(lines.reduce((sum, l) => sum + l.netAmount, 0));
  const taxTotal = round2(vat.reduce((sum, g) => sum + g.taxAmount, 0));
  const grandTotal = round2(lineTotal + taxTotal);

  if (grandTotal > 0 && !data.dueDate && !data.paymentTerms) {
    fail("BR-CO-25", "a positive amount due requires dueDate or paymentTerms");
  }

  return {
    ...data,
    title: `Invoice ${data.number}`,
    lines,
    vat,
    totals: { lineTotal, taxBasis: lineTotal, taxTotal, grandTotal, duePayable: grandTotal },
  };
}
