// Inputs arrive via `sys.inputs`:
//   data – the calculated invoice (CalculatedInvoice from src/models/dto/types.ts) as JSON
//   xml  – the matching CII document, embedded as factur-x.xml (ZUGFeRD)
#let inv = json(bytes(sys.inputs.at("data", default: "{}")))
#let xml = sys.inputs.at("xml", default: none)

#let opt(dict, key) = dict.at(key, default: none)
#let fmt-date(iso) = if iso == none { none } else {
  let (y, m, d) = iso.split("-")
  d + "." + m + "." + y
}
#let money(v) = {
  let cents = int(calc.round(v * 100))
  let sign = if cents < 0 { "-" } else { "" }
  let frac = calc.rem(calc.abs(cents), 100)
  sign + str(calc.quo(calc.abs(cents), 100)) + "." + (if frac < 10 { "0" }) + str(frac) + " " + inv.currency
}
#let pct(v) = str(v) + " %"
// Label/value pair, or nothing when the value is missing.
#let row(label, value) = if value == none { () } else { (label, [#value]) }

#let address(p) = {
  let a = p.address
  [#p.name \ #a.line1 \ ]
  if "line2" in a [#a.line2 \ ]
  [#a.postcode #a.city \ #a.countryCode]
}

#set document(title: inv.title, author: inv.seller.name)
#set text(font: "Libertinus Serif", size: 10pt, lang: "en")
#set page(
  paper: "a4",
  margin: (x: 20mm, top: 20mm, bottom: 32mm),
  footer: {
    set text(size: 7.5pt, fill: luma(80))
    let s = inv.seller
    let p = opt(inv, "payment")
    line(length: 100%, stroke: 0.3pt + luma(150))
    grid(
      columns: (1fr, 1fr, 1fr),
      gutter: 1em,
      address(s),
      [
        #if "vatId" in s [VAT ID: #s.vatId \ ]
        #if "taxNumber" in s [Tax no.: #s.taxNumber \ ]
        #if "email" in s [#s.email]
      ],
      if p != none and "iban" in p [
        IBAN: #p.iban \
        #if "bic" in p [BIC: #p.bic \ ]
        #if "accountName" in p [#p.accountName]
      ],
    )
  },
)

// The XML is what makes this a ZUGFeRD / Factur-X invoice. PDF/A-3 metadata
// (AF relationship, XMP) is added afterwards in src/zugferd/pdfa.ts.
#if xml != none {
  pdf.attach(
    "factur-x.xml",
    bytes(xml),
    relationship: "alternative",
    mime-type: "text/xml",
    description: "Factur-X/ZUGFeRD invoice data",
  )
}

#{
  let s = inv.seller.address
  text(size: 7pt)[#inv.seller.name · #s.line1 · #s.postcode #s.city]
}

#grid(
  columns: (1fr, auto),
  [
    #address(inv.buyer)
    #if "vatId" in inv.buyer [\ VAT ID: #inv.buyer.vatId]
  ],
  grid(
    columns: 2,
    column-gutter: 1.5em,
    row-gutter: 0.65em,
    ..row([Invoice no.], inv.number),
    ..row([Invoice date], fmt-date(inv.issueDate)),
    ..row([Delivery date], fmt-date(opt(inv, "deliveryDate"))),
    ..row([Your reference], opt(inv, "buyerReference")),
    ..row([Due date], fmt-date(opt(inv, "dueDate"))),
  ),
)

#v(1.5em)
= #inv.title
#v(0.5em)

#table(
  columns: (auto, 1fr, auto, auto, auto, auto),
  align: (right, left, right, right, right, right),
  stroke: (_, y) => (bottom: if y == 0 { 0.7pt } else { 0.3pt + luma(170) }),
  table.header([*Pos.*], [*Description*], [*Qty*], [*Unit price*], [*VAT*], [*Net amount*]),
  ..inv
    .lines
    .map(l => (
      [#l.id],
      [#l.description],
      [#l.quantity #l.unitLabel],
      money(l.unitPrice),
      pct(l.vatRate),
      money(l.netAmount),
    ))
    .flatten(),
)

#align(right, table(
  columns: 2,
  stroke: none,
  align: right,
  [Net total], money(inv.totals.lineTotal),
  ..inv.vat.map(g => ([VAT #pct(g.rate) on #money(g.basisAmount)], money(g.taxAmount))).flatten(),
  table.hline(stroke: 0.7pt),
  [*Total*], [*#money(inv.totals.grandTotal)*],
))

#for g in inv.vat.filter(g => "exemptionReason" in g) [
  VAT category #g.category: #g.exemptionReason \
]

#if "paymentTerms" in inv [#inv.paymentTerms \ ]
#{
  let p = opt(inv, "payment")
  if p != none and "iban" in p [
    Please transfer #money(inv.totals.duePayable) to IBAN #p.iban
    #if "bic" in p [(BIC #p.bic)] quoting #inv.number.
  ]
}

#if "notes" in inv {
  v(1em)
  emph(inv.notes)
}
