import puppeteer, { type Browser } from "puppeteer";
import { calculateInvoice, type TemplateEngine } from "../core.ts";
import type { CalculatedInvoice, Party } from "../models/dto/types.ts";
import { renderZugferdPdf } from "../zugferd/index.ts";

const money = (v: number, currency: string) => `${v.toFixed(2)} ${currency}`;
const pct = (v: number) => `${v} %`;
const fmtDate = (iso?: string) => (iso ? iso.split("-").reverse().join(".") : undefined);

// `safe` makes Kita escape user-provided strings (XSS protection).
function Address({ party }: { party: Party }) {
  const a = party.address;
  return (
    <>
      <span safe>{party.name}</span>
      <br />
      <span safe>{a.line1}</span>
      <br />
      {a.line2 && (
        <>
          <span safe>{a.line2}</span>
          <br />
        </>
      )}
      <span safe>{`${a.postcode} ${a.city}`}</span>
      <br />
      <span safe>{a.countryCode}</span>
    </>
  );
}

/** Label/value row, omitted when the value is missing. */
function InfoRow({ label, value }: { label: string; value?: string }) {
  if (!value) return "";
  return (
    <tr>
      <th>{label}</th>
      <td safe>{value}</td>
    </tr>
  );
}

function Invoice({ inv }: { inv: CalculatedInvoice }) {
  const m = (v: number) => money(v, inv.currency);
  const { seller, buyer, payment } = inv;
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <title safe>{inv.title}</title>
        <style>{`
          @page { size: A4; margin: 20mm 20mm 12mm; }
          body { font-family: serif; font-size: 10pt; margin: 0; padding-bottom: 25mm; }
          .sender { font-size: 7pt; }
          .head { display: flex; justify-content: space-between; gap: 2em; }
          .info th { text-align: left; font-weight: normal; padding-right: 1.5em; }
          table.items { width: 100%; border-collapse: collapse; }
          table.items th { border-bottom: 0.7pt solid #000; }
          table.items td { border-bottom: 0.3pt solid #aaa; }
          table.items th, table.items td { padding: 4px 6px; text-align: right; }
          table.items .desc { text-align: left; }
          table.totals { margin-left: auto; }
          table.totals td { text-align: right; padding: 2px 6px; }
          table.totals tr.total td { border-top: 0.7pt solid #000; font-weight: bold; }
          footer { position: fixed; bottom: 0; left: 0; right: 0; border-top: 0.3pt solid #999; padding-top: 0.5em;
                   display: grid; grid-template-columns: repeat(3, 1fr); gap: 1em; font-size: 7.5pt; color: #505050; }
        `}</style>
      </head>
      <body>
        <div class="sender" safe>
          {`${seller.name} · ${seller.address.line1} · ${seller.address.postcode} ${seller.address.city}`}
        </div>
        <div class="head">
          <p>
            <Address party={buyer} />
            {buyer.vatId && (
              <>
                <br />
                VAT ID: <span safe>{buyer.vatId}</span>
              </>
            )}
          </p>
          <table class="info">
            <InfoRow label="Invoice no." value={inv.number} />
            <InfoRow label="Invoice date" value={fmtDate(inv.issueDate)} />
            <InfoRow label="Delivery date" value={fmtDate(inv.deliveryDate)} />
            <InfoRow label="Your reference" value={inv.buyerReference} />
            <InfoRow label="Due date" value={fmtDate(inv.dueDate)} />
          </table>
        </div>

        <h1 safe>{inv.title}</h1>

        <table class="items">
          <thead>
            <tr>
              <th>Pos.</th>
              <th class="desc">Description</th>
              <th>Qty</th>
              <th>Unit price</th>
              <th>VAT</th>
              <th>Net amount</th>
            </tr>
          </thead>
          <tbody>
            {inv.lines.map((l) => (
              <tr>
                <td>{l.id}</td>
                <td class="desc" safe>
                  {l.description}
                </td>
                <td safe>{`${l.quantity} ${l.unitLabel}`}</td>
                <td safe>{m(l.unitPrice)}</td>
                <td>{pct(l.vatRate)}</td>
                <td safe>{m(l.netAmount)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <table class="totals">
          <tr>
            <td>Net total</td>
            <td safe>{m(inv.totals.lineTotal)}</td>
          </tr>
          {inv.vat.map((g) => (
            <tr>
              <td safe>{`VAT ${pct(g.rate)} on ${m(g.basisAmount)}`}</td>
              <td safe>{m(g.taxAmount)}</td>
            </tr>
          ))}
          <tr class="total">
            <td>Total</td>
            <td safe>{m(inv.totals.grandTotal)}</td>
          </tr>
        </table>

        {inv.vat
          .filter((g) => g.exemptionReason)
          .map((g) => (
            <p safe>{`VAT category ${g.category}: ${g.exemptionReason}`}</p>
          ))}

        <p>
          {inv.paymentTerms && (
            <>
              <span safe>{inv.paymentTerms}</span>
              <br />
            </>
          )}
          {payment?.iban && (
            <span safe>
              {`Please transfer ${m(inv.totals.duePayable)} to IBAN ${payment.iban}` +
                (payment.bic ? ` (BIC ${payment.bic})` : "") +
                ` quoting ${inv.number}.`}
            </span>
          )}
        </p>

        {inv.notes && (
          <p>
            <em safe>{inv.notes}</em>
          </p>
        )}

        <footer>
          <div>
            <Address party={seller} />
          </div>
          <div>
            {seller.vatId && (
              <>
                VAT ID: <span safe>{seller.vatId}</span>
                <br />
              </>
            )}
            {seller.taxNumber && (
              <>
                Tax no.: <span safe>{seller.taxNumber}</span>
                <br />
              </>
            )}
            {seller.email && <span safe>{seller.email}</span>}
          </div>
          <div>
            {payment?.iban && (
              <>
                IBAN: <span safe>{payment.iban}</span>
                <br />
                {payment.bic && (
                  <>
                    BIC: <span safe>{payment.bic}</span>
                    <br />
                  </>
                )}
                {payment.accountName && <span safe>{payment.accountName}</span>}
              </>
            )}
          </div>
        </footer>
      </body>
    </html>
  );
}

/**
 * Renders the invoice as HTML with Kita and prints it to PDF with headless
 * Chromium (Puppeteer); the HTML is an internal intermediate only. The result
 * is the same ZUGFeRD / Factur-X PDF/A-3b as the typst engine produces.
 */
export function createKitaEngine(): TemplateEngine {
  let browser: Promise<Browser> | undefined;
  // PUPPETEER_ARGS passes extra Chromium flags, e.g. "--no-sandbox" in containers.
  const args = process.env.PUPPETEER_ARGS?.split(" ").filter(Boolean);
  const getBrowser = () => (browser ??= puppeteer.launch({ args }));

  return {
    name: "kitajs",
    async init() {
      await getBrowser();
    },
    render(data) {
      const invoice = calculateInvoice(data);
      return renderZugferdPdf(invoice, "Kita HTML + Chromium", async () => {
        // No async components are used, so the element is always a plain string.
        const html = "<!doctype html>" + ((<Invoice inv={invoice} />) as string);
        const page = await (await getBrowser()).newPage();
        try {
          await page.setContent(html, { waitUntil: "load" });
          return await page.pdf({ preferCSSPageSize: true, printBackground: true });
        } finally {
          await page.close();
        }
      });
    },
    async close() {
      await (await browser)?.close();
      browser = undefined;
    },
  };
}
