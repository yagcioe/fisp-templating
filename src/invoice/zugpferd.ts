import { type Invoice, InvoiceService } from "@e-invoice-eu/core";
import type { Address, CalculatedInvoice, Contact, Party } from "../models/dto/types.ts";

/** Factur-X / ZUGFeRD profile "EN 16931" (alias "Comfort"). */
const FORMAT = "Factur-X-EN16931";

type Ubl = Invoice["ubl:Invoice"];
type Line = Ubl["cac:InvoiceLine"][number];

const service = new InvoiceService(console);

// The library takes all numbers as strings.
const amount = (v: number) => v.toFixed(2);
/** Up to 4 decimals, no trailing zeros, never exponent notation. */
const decimal = (v: number) => v.toFixed(4).replace(/\.?0+$/, "");

const VAT = { "cbc:ID": "VAT" };

function postalAddress(a: Address) {
  return {
    "cbc:StreetName": a.line1,
    "cbc:AdditionalStreetName": a.line2,
    "cbc:CityName": a.city,
    "cbc:PostalZone": a.postcode,
    "cac:Country": { "cbc:IdentificationCode": a.countryCode as Ubl["cac:AccountingSupplierParty"]["cac:Party"]["cac:PostalAddress"]["cac:Country"]["cbc:IdentificationCode"] },
  };
}

function contact(c: Contact | undefined) {
  if (!c || !(c.name || c.phone || c.email)) return undefined;
  return { "cbc:Name": c.name, "cbc:Telephone": c.phone, "cbc:ElectronicMail": c.email };
}

/** BT-34 / BT-49: the party's email as electronic address. */
function endpoint(p: Party) {
  return p.email ? { "cbc:EndpointID": p.email, "cbc:EndpointID@schemeID": "EM" as const } : {};
}

/**
 * Maps the calculated invoice onto the library's input format, which follows
 * UBL (EN 16931 syntax binding); the library converts it to CII.
 */
function toEInvoice(inv: CalculatedInvoice): Invoice {
  const currency = inv.currency as Ubl["cbc:DocumentCurrencyCode"];
  const { seller, buyer, payment } = inv;

  const lines = inv.lines.map(
    (l): Line => ({
      "cbc:ID": l.id,
      "cbc:InvoicedQuantity": decimal(l.quantity),
      "cbc:InvoicedQuantity@unitCode": l.unitCode as Line["cbc:InvoicedQuantity@unitCode"],
      "cbc:LineExtensionAmount": amount(l.netAmount),
      "cbc:LineExtensionAmount@currencyID": currency,
      "cac:Item": {
        "cbc:Name": l.description,
        "cac:ClassifiedTaxCategory": { "cbc:ID": l.vatCategory, "cbc:Percent": decimal(l.vatRate), "cac:TaxScheme": VAT },
      },
      "cac:Price": { "cbc:PriceAmount": decimal(l.unitPrice), "cbc:PriceAmount@currencyID": currency },
    }),
  );

  const ubl: Ubl = {
    "cbc:ID": inv.number,
    "cbc:IssueDate": inv.issueDate,
    "cbc:DueDate": inv.dueDate,
    "cbc:InvoiceTypeCode": "380",
    "cbc:Note": inv.notes ? [inv.notes] : undefined,
    "cbc:DocumentCurrencyCode": currency,
    "cbc:BuyerReference": inv.buyerReference,
    "cac:AccountingSupplierParty": {
      "cac:Party": {
        ...endpoint(seller),
        "cac:PostalAddress": postalAddress(seller.address),
        // The first entry's TaxScheme becomes schemeID VA (VAT) or FC; later entries keep their id as schemeID.
        "cac:PartyTaxScheme": [
          ...(seller.vatId ? [{ "cbc:CompanyID": seller.vatId, "cac:TaxScheme": VAT }] : []),
          ...(seller.taxNumber ? [{ "cbc:CompanyID": seller.taxNumber, "cac:TaxScheme": { "cbc:ID": "FC" } }] : []),
        ] as Ubl["cac:AccountingSupplierParty"]["cac:Party"]["cac:PartyTaxScheme"],
        "cac:PartyLegalEntity": { "cbc:RegistrationName": seller.name },
        "cac:Contact": contact(seller.contact),
      },
    },
    "cac:AccountingCustomerParty": {
      "cac:Party": {
        ...endpoint(buyer),
        "cac:PostalAddress": postalAddress(buyer.address),
        // EN 16931 only knows the buyer's VAT id (BT-48), no tax number.
        "cac:PartyTaxScheme": buyer.vatId ? { "cbc:CompanyID": buyer.vatId, "cac:TaxScheme": VAT } : undefined,
        "cac:PartyLegalEntity": { "cbc:RegistrationName": buyer.name },
      },
    },
    "cac:Delivery": inv.deliveryDate ? { "cbc:ActualDeliveryDate": inv.deliveryDate } : undefined,
    "cac:PaymentMeans": payment
      ? [
        {
          "cbc:PaymentMeansCode": payment.meansCode as NonNullable<Ubl["cac:PaymentMeans"]>[number]["cbc:PaymentMeansCode"],
          "cbc:PaymentID": inv.number,
          "cac:PayeeFinancialAccount": payment.iban
            ? {
              "cbc:ID": payment.iban,
              "cbc:Name": payment.accountName,
              "cac:FinancialInstitutionBranch": payment.bic ? { "cbc:ID": payment.bic } : undefined,
            }
            : undefined,
        },
      ]
      : undefined,
    "cac:PaymentTerms": inv.paymentTerms ? { "cbc:Note": inv.paymentTerms } : undefined,
    "cac:TaxTotal": [
      {
        "cbc:TaxAmount": amount(inv.totals.taxTotal),
        "cbc:TaxAmount@currencyID": currency,
        "cac:TaxSubtotal": inv.vat.map((g) => ({
          "cbc:TaxableAmount": amount(g.basisAmount),
          "cbc:TaxableAmount@currencyID": currency,
          "cbc:TaxAmount": amount(g.taxAmount),
          "cbc:TaxAmount@currencyID": currency,
          "cac:TaxCategory": {
            "cbc:ID": g.category,
            "cbc:Percent": decimal(g.rate),
            "cbc:TaxExemptionReason": g.exemptionReason,
            "cac:TaxScheme": VAT,
          },
        })),
      },
    ],
    "cac:LegalMonetaryTotal": {
      "cbc:LineExtensionAmount": amount(inv.totals.lineTotal),
      "cbc:LineExtensionAmount@currencyID": currency,
      "cbc:TaxExclusiveAmount": amount(inv.totals.taxBasis),
      "cbc:TaxExclusiveAmount@currencyID": currency,
      "cbc:TaxInclusiveAmount": amount(inv.totals.grandTotal),
      "cbc:TaxInclusiveAmount@currencyID": currency,
      "cbc:PayableAmount": amount(inv.totals.duePayable),
      "cbc:PayableAmount@currencyID": currency,
    },
    "cac:InvoiceLine": lines as Ubl["cac:InvoiceLine"],
  };

  // The library's JSON-schema validation rejects keys that are present but undefined.
  return { "ubl:Invoice": JSON.parse(JSON.stringify(ubl)) };
}

/**
 * Shared ZUGFeRD pipeline for all engines: the engine lays out the visual PDF,
 * @e-invoice-eu/core builds the CII XML, attaches it as factur-x.xml and turns
 * the PDF into PDF/A-3b Factur-X (EN 16931) with matching XMP metadata.
 */
export async function renderZugferdPdf(
  invoice: CalculatedInvoice,
  creator: string,
  pdf: Uint8Array,
): Promise<Uint8Array> {
  const result = await service.generate(toEInvoice(invoice), {
    format: FORMAT,
    lang: "en",
    pdf: { buffer: pdf, filename: `${invoice.number}.pdf`, mimetype: "application/pdf" },
    customMetadata: {
      title: invoice.title,
      author: invoice.seller.name,
      subject: `Invoice ${invoice.number} for ${invoice.buyer.name}`,
      creator,
    },
  });
  if (typeof result === "string") throw new Error(`${FORMAT} unexpectedly produced XML instead of a PDF`);
  return result;
}
