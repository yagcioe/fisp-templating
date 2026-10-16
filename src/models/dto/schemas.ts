import { z } from "zod";
import { sampleData } from "./examples.ts";

/*
 * Invoice model covering the fields required by EN 16931 (and therefore the
 * ZUGFeRD / Factur-X "EN 16931" profile). Business-term ids (BT-x) refer to
 * EN 16931-1; dates are ISO `YYYY-MM-DD`, country codes ISO 3166-1 alpha-2,
 * currency ISO 4217 and unit codes UN/ECE Rec. 20.
 *
 * These zod schemas are the single source of truth: the API validates request
 * bodies with them, the DTO types in ./types.ts are inferred from them and the
 * OpenAPI spec is generated from them (`id`s become components). They cover
 * structure only; business rules (BR-*) are enforced in calculateInvoice().
 */
const text = z.string().min(1);

export const AddressSchema = z.object({
  line1: text,
  line2: text.optional(),
  postcode: text,
  city: text,
  countryCode: z.string().regex(/^[A-Z]{2}$/).describe("BT-40 / BT-55"),
}).meta({ id: "Address" });

export const PartySchema = z.object({
  name: text,
  address: AddressSchema,
  vatId: text.optional().describe("BT-31 / BT-48; required for the seller (BR-CO-26)"),
  taxNumber: text.optional().describe("BT-32, local tax number (Steuernummer); does not replace the seller VAT id"),
  email: text.optional().describe("BT-34 / BT-49 electronic address"),
}).meta({ id: "Party" });

export const ContactSchema = z.object({
  name: text.optional(),
  phone: text.optional(),
  email: text.optional(),
}).meta({ id: "Contact" });

export const VatCategorySchema = z
  .enum(["S", "Z", "E", "AE"])
  .meta({ id: "VatCategory", description: "VAT category codes (UNTDID 5305) supported by this generator" });

export const InvoiceLineSchema = z.object({
  description: text,
  quantity: z.number(),
  unitCode: text.describe("BT-130, e.g. C62 (piece), HUR (hour), MON (month)"),
  unitPrice: z.number().describe("BT-146, net price per unit"),
  vatCategory: VatCategorySchema,
  vatRate: z.number().min(0).describe("BT-152, percent; must be 0 for Z/E/AE"),
}).meta({ id: "InvoiceLine" });

export const PaymentInfoSchema = z.object({
  meansCode: text.describe("BT-81, UNTDID 4461, e.g. 58 = SEPA credit transfer"),
  iban: text.optional(),
  bic: text.optional(),
  accountName: text.optional(),
}).meta({ id: "PaymentInfo" });

const invoiceDataObject = z.object({
  number: text.describe("BT-1"),
  issueDate: z.iso.date().describe("BT-2"),
  currency: z.string().regex(/^[A-Z]{3}$/).describe("BT-5"),
  buyerReference: text.optional().describe("BT-10, e.g. Leitweg-ID or purchase order reference"),
  deliveryDate: z.iso.date().optional().describe("BT-72, date of supply"),
  dueDate: z.iso.date().optional().describe("BT-9"),
  paymentTerms: text.optional().describe("BT-20"),
  seller: PartySchema.extend({ contact: ContactSchema.optional() }),
  buyer: PartySchema,
  payment: PaymentInfoSchema.optional(),
  lines: z.array(InvoiceLineSchema).min(1),
  vatExemptionReason: text.optional().describe("BT-120, required when a line uses category E or AE"),
  notes: text.optional().describe("BT-22"),
});

// Annotated explicitly: the example is typed from this schema, which would
// otherwise make the inferred type circular.
export const InvoiceDataSchema: typeof invoiceDataObject = invoiceDataObject.meta({
  id: "InvoiceData",
  description: "Payload accepted by the API and handed to every template engine",
  examples: [sampleData],
});

/*
 * Output of calculateInvoice(): the view model shared by all templates and the
 * CII XML generator. Not validated at runtime; the schemas only define the types.
 */
export const CalculatedLineSchema = InvoiceLineSchema.extend({
  id: z.string().describe("BT-126"),
  netAmount: z.number().describe("BT-131"),
  unitLabel: z.string(),
});

export const VatBreakdownSchema = z.object({
  category: VatCategorySchema,
  rate: z.number(),
  basisAmount: z.number().describe("BT-116"),
  taxAmount: z.number().describe("BT-117"),
  exemptionReason: z.string().optional(),
});

export const CalculatedInvoiceSchema = InvoiceDataSchema.extend({
  title: z.string(),
  lines: z.array(CalculatedLineSchema),
  vat: z.array(VatBreakdownSchema),
  totals: z.object({
    lineTotal: z.number().describe("BT-106"),
    taxBasis: z.number().describe("BT-109"),
    taxTotal: z.number().describe("BT-110"),
    grandTotal: z.number().describe("BT-112"),
    duePayable: z.number().describe("BT-115"),
  }),
});

/** Error body for validation and business-rule failures (400) and a busy benchmark (409). */
export const ErrorResponseSchema = z
  .object({
    statusCode: z.number(),
    code: z.string().optional(),
    error: z.string(),
    message: z.string(),
  })
  .meta({ id: "ErrorResponse" });

/** Output of an engine: ZUGFeRD PDF or plain HTML. */
export const OutputFormatSchema = z
  .enum(["pdf", "html"])
  .meta({ id: "OutputFormat", description: "`pdf`: ZUGFeRD / Factur-X PDF/A-3b, `html`: plain HTML without e-invoice data" });

/** Options of POST /benchmark; the engine list is narrowed to the registered engines in app.ts. */
export const BenchmarkRequestSchema = z.object({
  iterations: z.number().int().min(1).max(1000).default(20).describe("Measured renders per engine and format"),
  warmup: z.number().int().min(0).max(100).default(10).describe("Unmeasured renders per engine and format before measuring"),
  formats: z.array(OutputFormatSchema).min(1).default(["pdf", "html"]).describe("Output formats to benchmark; default: both"),
  engines: z.array(z.string().min(1)).min(1).optional().describe("Engines to benchmark; default: all"),
  invoice: InvoiceDataSchema.optional().describe("Invoice to render; default: the sample invoice"),
});

export const BenchmarkEngineResultSchema = z
  .object({
    engine: z.string(),
    format: OutputFormatSchema,
    meanMs: z.number(),
    p50Ms: z.number(),
    p95Ms: z.number(),
    minMs: z.number(),
    maxMs: z.number(),
    opsPerSec: z.number(),
    outputBytes: z.number().int(),
  })
  .meta({ id: "BenchmarkEngineResult" });

export const BenchmarkResultSchema = z
  .object({
    iterations: z.number().int(),
    warmup: z.number().int(),
    results: z.array(BenchmarkEngineResultSchema),
  })
  .meta({ id: "BenchmarkResult" });
