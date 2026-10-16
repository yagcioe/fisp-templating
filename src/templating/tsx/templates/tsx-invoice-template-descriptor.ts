import type { CalculatedInvoice } from "../../../models/dto/types.ts";
import type { TsxTemplateDescriptor } from "../tsx-template-descriptor.ts";
import { toHtml } from "./invoice.tsx";

export class TsxInvoiceTemplateDescriptor implements TsxTemplateDescriptor<CalculatedInvoice> {
    constructor(public readonly data: CalculatedInvoice) { }
    public getTemplate = (data: CalculatedInvoice) => toHtml(data)
}