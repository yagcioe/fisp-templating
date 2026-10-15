import type { Address, CalculatedInvoice, Contact, Party } from "../models/dto/types.ts";
import { escapeXml as esc } from "./xml.ts";

/** Guideline id (BT-24) of the ZUGFeRD 2.x / Factur-X "EN 16931" profile. */
export const EN16931_GUIDELINE = "urn:cen.eu:en16931:2017";

const amount = (v: number) => v.toFixed(2);
/** Up to 4 decimals, no trailing zeros, never exponent notation. */
const decimal = (v: number) => v.toFixed(4).replace(/\.?0+$/, "");
const date = (iso: string) => `<udt:DateTimeString format="102">${iso.replaceAll("-", "")}</udt:DateTimeString>`;
const opt = (value: string | undefined, render: (v: string) => string) => (value ? render(value) : "");

function address(a: Address): string {
  return `<ram:PostalTradeAddress>
          <ram:PostcodeCode>${esc(a.postcode)}</ram:PostcodeCode>
          <ram:LineOne>${esc(a.line1)}</ram:LineOne>${opt(a.line2, (v) => `
          <ram:LineTwo>${esc(v)}</ram:LineTwo>`)}
          <ram:CityName>${esc(a.city)}</ram:CityName>
          <ram:CountryID>${esc(a.countryCode)}</ram:CountryID>
        </ram:PostalTradeAddress>`;
}

function contact(c: Contact | undefined): string {
  if (!c || !(c.name || c.phone || c.email)) return "";
  return `
        <ram:DefinedTradeContact>${opt(c.name, (v) => `
          <ram:PersonName>${esc(v)}</ram:PersonName>`)}${opt(c.phone, (v) => `
          <ram:TelephoneUniversalCommunication><ram:CompleteNumber>${esc(v)}</ram:CompleteNumber></ram:TelephoneUniversalCommunication>`)}${opt(c.email, (v) => `
          <ram:EmailURIUniversalCommunication><ram:URIID>${esc(v)}</ram:URIID></ram:EmailURIUniversalCommunication>`)}
        </ram:DefinedTradeContact>`;
}

function party(tag: string, p: Party & { contact?: Contact }): string {
  return `<ram:${tag}>
        <ram:Name>${esc(p.name)}</ram:Name>${contact(p.contact)}
        ${address(p.address)}${opt(p.email, (v) => `
        <ram:URIUniversalCommunication><ram:URIID schemeID="EM">${esc(v)}</ram:URIID></ram:URIUniversalCommunication>`)}${opt(p.taxNumber, (v) => `
        <ram:SpecifiedTaxRegistration><ram:ID schemeID="FC">${esc(v)}</ram:ID></ram:SpecifiedTaxRegistration>`)}${opt(p.vatId, (v) => `
        <ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${esc(v)}</ram:ID></ram:SpecifiedTaxRegistration>`)}
      </ram:${tag}>`;
}

/** Builds a UN/CEFACT Cross Industry Invoice (D16B) for the EN 16931 profile. */
export function buildCiiXml(inv: CalculatedInvoice): string {
  const cur = esc(inv.currency);

  const lines = inv.lines
    .map(
      (l) => `
    <ram:IncludedSupplyChainTradeLineItem>
      <ram:AssociatedDocumentLineDocument><ram:LineID>${l.id}</ram:LineID></ram:AssociatedDocumentLineDocument>
      <ram:SpecifiedTradeProduct><ram:Name>${esc(l.description)}</ram:Name></ram:SpecifiedTradeProduct>
      <ram:SpecifiedLineTradeAgreement>
        <ram:NetPriceProductTradePrice><ram:ChargeAmount>${decimal(l.unitPrice)}</ram:ChargeAmount></ram:NetPriceProductTradePrice>
      </ram:SpecifiedLineTradeAgreement>
      <ram:SpecifiedLineTradeDelivery>
        <ram:BilledQuantity unitCode="${esc(l.unitCode)}">${decimal(l.quantity)}</ram:BilledQuantity>
      </ram:SpecifiedLineTradeDelivery>
      <ram:SpecifiedLineTradeSettlement>
        <ram:ApplicableTradeTax>
          <ram:TypeCode>VAT</ram:TypeCode>
          <ram:CategoryCode>${l.vatCategory}</ram:CategoryCode>
          <ram:RateApplicablePercent>${decimal(l.vatRate)}</ram:RateApplicablePercent>
        </ram:ApplicableTradeTax>
        <ram:SpecifiedTradeSettlementLineMonetarySummation>
          <ram:LineTotalAmount>${amount(l.netAmount)}</ram:LineTotalAmount>
        </ram:SpecifiedTradeSettlementLineMonetarySummation>
      </ram:SpecifiedLineTradeSettlement>
    </ram:IncludedSupplyChainTradeLineItem>`,
    )
    .join("");

  const vat = inv.vat
    .map(
      (g) => `
      <ram:ApplicableTradeTax>
        <ram:CalculatedAmount>${amount(g.taxAmount)}</ram:CalculatedAmount>
        <ram:TypeCode>VAT</ram:TypeCode>${opt(g.exemptionReason, (v) => `
        <ram:ExemptionReason>${esc(v)}</ram:ExemptionReason>`)}
        <ram:BasisAmount>${amount(g.basisAmount)}</ram:BasisAmount>
        <ram:CategoryCode>${g.category}</ram:CategoryCode>
        <ram:RateApplicablePercent>${decimal(g.rate)}</ram:RateApplicablePercent>
      </ram:ApplicableTradeTax>`,
    )
    .join("");

  const p = inv.payment;
  const paymentMeans = p
    ? `
      <ram:SpecifiedTradeSettlementPaymentMeans>
        <ram:TypeCode>${esc(p.meansCode)}</ram:TypeCode>${opt(p.iban, (v) => `
        <ram:PayeePartyCreditorFinancialAccount>
          <ram:IBANID>${esc(v)}</ram:IBANID>${opt(p.accountName, (n) => `
          <ram:AccountName>${esc(n)}</ram:AccountName>`)}
        </ram:PayeePartyCreditorFinancialAccount>`)}${opt(p.bic, (v) => `
        <ram:PayeeSpecifiedCreditorFinancialInstitution><ram:BICID>${esc(v)}</ram:BICID></ram:PayeeSpecifiedCreditorFinancialInstitution>`)}
      </ram:SpecifiedTradeSettlementPaymentMeans>`
    : "";

  const paymentTerms =
    inv.paymentTerms || inv.dueDate
      ? `
      <ram:SpecifiedTradePaymentTerms>${opt(inv.paymentTerms, (v) => `
        <ram:Description>${esc(v)}</ram:Description>`)}${opt(inv.dueDate, (v) => `
        <ram:DueDateDateTime>${date(v)}</ram:DueDateDateTime>`)}
      </ram:SpecifiedTradePaymentTerms>`
      : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"
  xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100"
  xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100"
  xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <rsm:ExchangedDocumentContext>
    <ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>${EN16931_GUIDELINE}</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter>
  </rsm:ExchangedDocumentContext>
  <rsm:ExchangedDocument>
    <ram:ID>${esc(inv.number)}</ram:ID>
    <ram:TypeCode>380</ram:TypeCode>
    <ram:IssueDateTime>${date(inv.issueDate)}</ram:IssueDateTime>${opt(inv.notes, (v) => `
    <ram:IncludedNote><ram:Content>${esc(v)}</ram:Content></ram:IncludedNote>`)}
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>${lines}
    <ram:ApplicableHeaderTradeAgreement>${opt(inv.buyerReference, (v) => `
      <ram:BuyerReference>${esc(v)}</ram:BuyerReference>`)}
      ${party("SellerTradeParty", inv.seller)}
      ${party("BuyerTradeParty", inv.buyer)}
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeDelivery>${opt(inv.deliveryDate, (v) => `
      <ram:ActualDeliverySupplyChainEvent><ram:OccurrenceDateTime>${date(v)}</ram:OccurrenceDateTime></ram:ActualDeliverySupplyChainEvent>`)}
    </ram:ApplicableHeaderTradeDelivery>
    <ram:ApplicableHeaderTradeSettlement>
      <ram:PaymentReference>${esc(inv.number)}</ram:PaymentReference>
      <ram:InvoiceCurrencyCode>${cur}</ram:InvoiceCurrencyCode>${paymentMeans}${vat}${paymentTerms}
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:LineTotalAmount>${amount(inv.totals.lineTotal)}</ram:LineTotalAmount>
        <ram:TaxBasisTotalAmount>${amount(inv.totals.taxBasis)}</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="${cur}">${amount(inv.totals.taxTotal)}</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>${amount(inv.totals.grandTotal)}</ram:GrandTotalAmount>
        <ram:DuePayableAmount>${amount(inv.totals.duePayable)}</ram:DuePayableAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>
`;
}
