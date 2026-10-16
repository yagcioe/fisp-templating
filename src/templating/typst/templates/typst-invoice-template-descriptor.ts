import { readFile } from "node:fs/promises";
import type { CalculatedInvoice } from "../../../models/dto/types.ts";
import type { TypstTemplateDescriptor } from "../typst-template-descriptor.ts";

export class TypstInvoiceTemplateDescriptor implements TypstTemplateDescriptor<CalculatedInvoice> {
    constructor(public readonly data: CalculatedInvoice) { }
    public getTemplate = () => readFile(new URL("./invoice.typ", import.meta.url), "utf8");
}