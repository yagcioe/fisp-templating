import type { z } from "zod";
import type {
  AddressSchema,
  BenchmarkEngineResultSchema,
  BenchmarkResultSchema,
  CalculatedInvoiceSchema,
  CalculatedLineSchema,
  ContactSchema,
  InvoiceDataSchema,
  InvoiceLineSchema,
  PartySchema,
  PaymentInfoSchema,
  VatBreakdownSchema,
  VatCategorySchema,
} from "./schemas.ts";

export type Address = z.infer<typeof AddressSchema>;
export type Party = z.infer<typeof PartySchema>;
export type Contact = z.infer<typeof ContactSchema>;
export type VatCategory = z.infer<typeof VatCategorySchema>;
export type InvoiceLine = z.infer<typeof InvoiceLineSchema>;
export type PaymentInfo = z.infer<typeof PaymentInfoSchema>;
export type InvoiceData = z.infer<typeof InvoiceDataSchema>;
export type CalculatedLine = z.infer<typeof CalculatedLineSchema>;
export type VatBreakdown = z.infer<typeof VatBreakdownSchema>;
export type CalculatedInvoice = z.infer<typeof CalculatedInvoiceSchema>;
export type BenchmarkEngineResult = z.infer<typeof BenchmarkEngineResultSchema>;
export type BenchmarkResult = z.infer<typeof BenchmarkResultSchema>;
