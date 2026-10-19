#import "@preview/touying:0.6.1": *
#import themes.metropolis: *
#import "@preview/fletcher:0.5.8" as fletcher: diagram, edge, node
#import "@preview/cades:0.3.1": qr-code

#let accent = rgb("#ff455d")
#let soft = rgb("#f3f3f3")
#let ok = rgb("#2e7d32")
#let bad = rgb("#ff0000")
#let mid = rgb("#ef8f00")
#let komuno = rgb("#00a49f")
#show: metropolis-theme.with(
  aspect-ratio: "16-9",
  footer: self => self.info.title,
  config-info(
    title: [Templating für HTML & PDF-Generierung],
    subtitle: [Zwei Ansätze in Node.js],
    author: [Ömer Yagci],
    date: datetime.today(),
    institution: [Finanz Informatik Solutions Plus],
  ),
  config-colors(
    primary: accent,
    primary-light: rgb("#f2b3bb"),
    secondary: komuno,
    neutral-lightest: rgb("#fafafa"),
    neutral-dark: komuno,
    neutral-darkest: komuno,
  ),
)

#set text(lang: "de", size: 19pt, font: "Interstate")
#show raw.where(block: true): set text(size: 14pt)
#show strong: set text(fill: komuno)
#show raw.where(block: true): block.with(fill: soft, inset: 10pt, radius: 4pt, width: 100%)

#let box-node(pos, body, fill: soft, ..args) = node(
  pos,
  body,
  fill: fill,
  shape: rect,
  corner-radius: 4pt,
  inset: 10pt,
  ..args,
)
#let yes(t) = text(fill: ok, t)
#let no(t) = text(fill: bad, t)
#let meh(t) = text(fill: mid, t)

#title-slide()

// ---------------------------------------------------------------------------
= Problemstellung

== Ausgangslage

#grid(
  columns: (1fr, 1fr),
  gutter: 1.5em,
  [
    *E-Mail-Benachrichtigung*, z. B. für:
    - Transaktion abgeschlossen
    - Neue Anmeldung an meinem Account
    - System-Fehler #sym.arrow Info an Admin
    - …
  ],
  [
    *PDF-Generierung*, z. B. für:
    - Dokumentation einer Transaktion
    - Automatisch generierte Berichte
    - (ZUGFeRD-)Rechnungen
    - ...
  ],
)

#v(1em)
#align(center, block(fill: soft, inset: 14pt, radius: 4pt)[
  Beide Probleme sind ähnlich: *Ein Template wird mit Daten befüllt.*
])

== Das Problem - Rechnungen

*Eine Rechnung -- zwei Ausgabeformate, gleiche Daten.*

#v(0.4em)
#grid(
  columns: (1fr, 1fr),
  gutter: 1.5em,
  block(fill: soft, inset: 14pt, radius: 4pt, width: 100%)[
    *HTML*
    - Rechnung als *E-Mail*
    - Web-Ansicht, z. B. im Online-Banking-Postfach
  ],
  block(fill: rgb("#fde3e6"), inset: 14pt, radius: 4pt, width: 100%)[
    *PDF inkl. ZUGFeRD*
    - Sichtbare Rechnung für Menschen
    - Eingebettetes XML für die Buchhaltung
    - Archivierbar (PDF/A-3b)
  ],
)

== Was ist ZUGFeRD?

#grid(
  columns: (1.35fr, 1fr),
  gutter: 1.5em,
  align: horizon,
  [
    #set text(size: 16pt)
    - *Hybride E-Rechnung:* ein PDF für Menschen, mit eingebettetem XML für Maschinen

    - *Pflicht im B2B:* Empfang seit 2025, Versand ab 2027 / 2028
  ],
  [
    #set text(size: 14pt)
    #block(stroke: 1pt + accent, inset: 10pt, radius: 4pt, width: 100%)[
      *PDF/A-3b* #h(1fr) #text(size: 0.75em)[archivierbar]
      #v(0.2em)
      #block(fill: soft, inset: 8pt, radius: 3pt, width: 100%)[
        Sichtbare Rechnung \ #text(size: 0.75em)[Layout aus der Templating Engine]
      ]
      #block(fill: rgb("#fde3e6"), inset: 8pt, radius: 3pt, width: 100%)[
        #sym.plus `factur-x.xml` (Anhang) \ #text(size: 0.75em)[strukturierte Daten zum automatischen Verbuchen]
      ]
    ]
  ],
)



== Blockdiagramm

// Daten + Template → Engine → Format → Consumer (eine Zeile pro Zielformat)
#let pipeline(format, consumers) = {
  let n = consumers.len()
  let mid = (n - 1) / 2
  let h = 1.9em
  diagram(
    spacing: (2.2em, 0.55em),
    node-stroke: 1pt,
    edge-stroke: 1.2pt,
    box-node((0, mid - 0.5), [*Daten*], width: 6.5em, height: h),
    box-node((0, mid + 0.5), [*Template*], stroke: (dash: "dashed"), width: 6.5em, height: h),
    box-node((1, mid), [*Templating Engine*], fill: rgb("#fde3e6"), stroke: accent, height: h),
    box-node((2, mid), format, width: 5em, height: h),
    edge((0, mid - 0.5), (1, mid), "-|>"),
    edge((0, mid + 0.5), (1, mid), "-|>"),
    edge((1, mid), (2, mid), "-|>"),
    ..consumers
      .enumerate()
      .map(((i, c)) => (
        box-node((4, i), text(size: 0.85em, c), fill: white, width: 12em, height: h, inset: 5pt),
        if i == mid { edge((2, mid), (4, i), "-|>") } else { edge((2, mid), (3, mid), (3, i), (4, i), "-|>") },
      ))
      .flatten(),
  )
}

#align(center + horizon)[#set text(size: 14pt)
  #stack(
    spacing: 0.8em,
    pipeline(
      [*HTML*],
      (
        [*Browser* -- Web-Ansicht],
        [*E-Mail* -- Benachrichtigung],
        [*Online-Banking* -- Postfach],
      ),
    ),
    line(length: 90%, stroke: 0.5pt + luma(200)),
    pipeline(
      [*PDF*],
      (
        [*DATEV* -- Buchhaltung],
        [*Datei* -- Archiv / DMS],
        [*E-Mail-Anhang* -- Kunde],
        [*Drucker* -- Postversand],
      ),
    ),
  )]

== Worauf kommt es technisch an?

#grid(
  columns: (1fr, 1fr, 1fr),
  row-gutter: 0.9em,
  column-gutter: 1em,
  [*Type Safety* \ #text(size: 0.75em)[Fehler zur Compile-Zeit]],
  [*Flexibility* \ #text(size: 0.75em)[Komponenten, Layouts, Logik]],
  [*Efficiency* \ #text(size: 0.75em)[Latenz, Durchsatz]],

  [*Ecosystem* \ #text(size: 0.75em)[Pakete, Community]],
  [*Lesen & Schreiben* \ #text(size: 0.75em)[Lernkurve, Tooling]],
  [*Debugging* \ #text(size: 0.75em)[Fehlersuche]],
)

// ---------------------------------------------------------------------------
= Lösungsansätze

== Welche Lösungen gibt es?

*Recherche*
- Google: `templating engine node.js`
- Claude: _"Which technologies should I use to generate HTML templates in my backend?"_

*Ergebnisse:* interpolierte Strings, Handlebars, EJS, Pug, Mustache, Eta
\ \
#grid(
  columns: (1fr, 1fr),
  gutter: 1.5em,
  align: top,
  [
    *Problem klassischer Engines:* \
    bieten kaum bis keine Typsicherheit.
    ```hbs
    <p>Hallo {{custmer.name}},</p>
    ```
  ],
  [
    *Typsichere Alternativen*
    - TSX mit `@kitajs/html` + Chrome
    - typst
  ],
)

// ---------------------------------------------------------------------------
= Technologien

== Kita & Puppeteer

#[
  #show raw.where(block: true): set text(size: 12pt)
  #grid(
    columns: (1fr, 1fr),
    gutter: 1.5em,
    [
      *`@kitajs/html`* -- TSX-Templates
      #set text(size: 16pt)
      - JSX/TSX wird direkt zu *Strings* kompiliert -- kein React, kein VDOM
      - Typen kommen aus TypeScript, Komponenten sind Funktionen

      #v(0.3em)
      ```tsx
      function Greeting({ name }: { name: string }) {
        return <p>Hallo <b safe>{name}</b></p>;
      }
      ```
    ],
    [
      *Puppeteer* -- Headless Chrome
      #set text(size: 16pt)
      - Bibliothek zum steuern von Brwosern (für End-2-End Tests)
      - Browser können eine HTML mit der Druckfunktion als PDF ausgeben
      #v(0.3em)
      ```ts
      const page = await browser.newPage();
      await page.setContent(html);
      const pdf = await page.pdf({ format: "A4" });
      ```
    ],
  )
]
\
Mit diser Templating Engine kann man sowohl HTML und PDFs generieren

== typst

#grid(
  columns: (1.1fr, 1fr),
  gutter: 1.5em,
  [
    #set text(size: 16pt)
    - Modernes *Satzsystem* -- Alternative zu LaTeX, in Rust, Open Source
    - Markup + vollwertige *Skriptsprache* (Variablen, Funktionen, Schleifen)
    - Kompiliert in Millisekunden, inkrementell
    - Ausgabe: PDF (auch PDF/A), PNG, SVG, HTML
    - Läuft als CLI oder als *WASM* im Browser / in Node (`typst-wasm`)
    - Pakete & Templates im *typst Universe*
  ],
  [
    #set text(size: 15pt)
    #let demo = "#let items = (\"Beratung\", \"Hosting\")
#for (i, x) in items.enumerate() [
  + #x (Pos. #(i + 1))
]"
    #raw(demo, lang: "typ", block: true)
    #align(center, text(size: 0.8em)[#sym.arrow.b gerendert])
    #block(stroke: 0.5pt + luma(180), inset: 10pt, radius: 4pt, width: 100%, eval(demo, mode: "markup"))
  ],
)

#v(0.6em)
#align(center, block(stroke: rgb("#00a49f"), inset: 12pt, radius: 4pt)[
  Diese Präsentation ist mit *typst* erstellt.
])

== Vergleich

#[
  #set text(size: 13pt)
  #table(
    columns: (auto, 0.8fr, 0.9fr, 0.9fr, 1.1fr, 1.1fr, 1.2fr, 1.1fr),
    inset: 6pt,
    align: left + horizon,
    stroke: (_, y) => (bottom: if y == 0 { 1pt + accent } else { 0.4pt + luma(200) }),
    fill: (_, y) => if y == 0 { soft },
    table.header(
      [],
      [*Type Safety*],
      [*Reusa\-bility*],
      [*Efficiency*],
      [*Flexibility*],
      [*Lesen & Schreiben*],
      [*Ecosystem*],
      [*Debugging*],
    ),
    [*Interpolierte Strings*], yes[Ja], meh[Mittel], yes[Schnell\*], yes[Gut], meh[Mittel], [–], yes[Gut],
    [*Klassisch* \ #text(size: 0.8em)[Handlebars, EJS, …]], no[Nein], [--], [--], [--], [--], [--], [--],
    [*TSX* \ #text(size: 0.8em)[`@kitajs`]],
    yes[Ja],
    yes[Gut],
    yes[Schnell\*],
    yes[Gut],
    yes[wie React],
    yes[npm (3,1 Mio.)],
    yes[Gut],

    [*typst*], yes[Ja], yes[Gut], yes[Schnell\*], yes[Gut], meh[neue Sprache], meh[Universe (800+)], meh[Mittel],
  )
  #text(size: 11pt)[\* Ausführungsgeschwindigkeit hängt vom Output Format (PDF / HTML) ab]
]

// ---------------------------------------------------------------------------
= Proof of Concept: `HTML Text & ZUGFeRD-Rechnung`
== Die Idee

*Eine ZUGFeRD-Rechnung (PDF/A-3b, EN 16931) – zwei Engines, gleiche Daten.*

#v(0.4em)
- *Fastify*-Server: `POST /render/:engine?format=pdf|html` nimmt Rechnung als JSON
- *Engine 1 (`tsx`):* TSX mit `@kitajs/html` #sym.arrow HTML (#sym.arrow headless Chromium #sym.arrow PDF)
- *Engine 2 (`typst`):* `typst-wasm` – typst-Compiler als WASM im Worker-Thread #sym.arrow PDF oder HTML
- *E-Rechnung* für beide gleich: `@e-invoice-eu/core` erzeugt das CII-XML und macht das PDF zu Factur-X (PDF/A-3b)

== Architektur

#align(center + horizon)[#set text(size: 15pt)
  #diagram(
    spacing: (1.4em, 1.2em),
    node-stroke: 1pt,
    edge-stroke: 1.1pt,
    box-node((0, 1), [JSON \ #text(size: 0.7em)[Request]]),
    box-node((1, 1), [`zod` \ #text(size: 0.7em)[Schema]]),
    box-node((2, 1), [`calculate` \ `Invoice` \ #text(size: 0.7em)[BR-Regeln]]),
    box-node((3, 0), [Kita TSX], fill: rgb("#fde3e6"), stroke: accent),
    box-node((3, 2), [typst \ #text(size: 0.7em)[WASM, PDF/A-3b]], fill: rgb("#fde3e6"), stroke: accent),
    box-node((4, 0), [Chromium], fill: rgb("#fde3e6"), stroke: accent),
    box-node((4, 1), [*HTML*], stroke: (dash: "dashed")),
    box-node((5, 1), [`@e-invoice-eu` \ `/core` \ #text(size: 0.7em)[CII-XML + PDF/A-3b]]),
    box-node((6, 1), [*PDF*]),
    edge((0, 1), (1, 1), "-|>"),
    edge((1, 1), (2, 1), "-|>"),
    edge((2, 1), (3, 0), "-|>"),
    edge((2, 1), (3, 2), "-|>"),
    edge((3, 0), (4, 0), "-|>"),
    edge((4, 0), (5, 0), (5, 1), "-|>"),
    edge((3, 2), (5, 2), (5, 1), "-|>"),
    edge((3, 0), (4, 1), "-|>", stroke: (dash: "dashed")),
    edge((3, 2), (4, 1), "-|>", stroke: (dash: "dashed")),
    edge((5, 1), (6, 1), "-|>"),
  )]
#align(center, text(
  size: 0.75em,
)[Rot = engine-spezifisch, alles andere ist geteilt. Gestrichelt: `format=html` (ohne E-Rechnung).])

== Abstraktion: Engine & Descriptor

#grid(
  columns: (1.45fr, 1fr),
  gutter: 1.2em,
  [
    #show raw.where(block: true): set text(size: 11.5pt)
    ```ts
    interface TemplateEngine {
      init?(): Promise<void>;
      render<D>(d: D, format: "pdf"): Promise<Uint8Array>;
      render<D>(d: D, format: "html"): Promise<string>;
      close?(): Promise<void>;
    }

    class TypstInvoiceTemplateDescriptor
      implements TypstTemplateDescriptor<CalculatedInvoice> {
      constructor(readonly data: CalculatedInvoice) {}
      getTemplate = () => readFile("./invoice.typ");
    }
    ```
  ],
  [
    #set text(size: 16pt)
    - *Engine* = _wie_ gerendert wird (Chromium, WASM-Compiler)
    - *Descriptor* = _was_ gerendert wird (Template + Daten)
    - Neues Dokument (z. B. Mahnung) #sym.arrow neuer Descriptor, Engines bleiben
    - *Dependency Injection*: `TemplateService` & `InvoiceService` als Singletons
  ],
)


== Engine 1: TSX mit `@kitajs/html`

#grid(
  columns: (1.3fr, 1fr),
  gutter: 1.2em,
  [
    #show raw.where(block: true): set text(size: 12.5pt)
    ```tsx
    {inv.lines.map((l) => (
      <tr>
        <td>{l.id}</td>
        <td class="desc" safe>{l.description}</td>
        <td safe>{`${l.quantity} ${l.unitLabel}`}</td>
        <td safe>{m(l.unitPrice)}</td>
        <td>{pct(l.vatRate)}</td>
        <td safe>{m(l.netAmount)}</td>
      </tr>
    ))}
    ```
  ],
  [
    - Syntax wie React, aber *nur String-Konkatenation*
    - Komponenten: `<Address party={…} />`
    - Funktionen erzeugen den HTML-String #sym.arrow fertig für *E-Mails*
    - Für *PDFs*: Chromium druckt das HTML, PDF/A-3b + XML Header kommen danach
  ],
)

== Engine 2: typst

#grid(
  columns: (1.3fr, 1fr),
  gutter: 1.2em,
  [
    ```typ
    #let inv = cbor(sys.inputs.data)

    #table(
      columns: (auto, 1fr, auto, auto, auto, auto),
      table.header([*Pos.*], [*Description*], …),
      ..inv.lines.map(l => (
        [#l.id], [#l.description],
        [#l.quantity #l.unitLabel],
        money(l.unitPrice), pct(l.vatRate),
        money(l.netAmount),
      )).flatten(),
    )
    ```
  ],
  [
    - Eigene Satz-Engine, *kein Browser*
    - Daten als *CBOR* oder *JSON*: virtuelle Datei pro Render, Pfad via CLI Parameter
    - Schreibt *PDF/A-3b nativ* (`pdfStandards: ["a3b"]`) – das XML hängt die geteilte Pipeline an
    - Compiler gibt auch *HTML* aus (experimental)
  ],
)

== Ergebnis: dieselbe Rechnung

#grid(
  columns: (1fr, 1fr),
  gutter: 1.5em,
  align: center,
  [
    #box(stroke: 0.5pt + luma(180), image("./assets/kitajs.pdf", height: 80%))
    #v(-0.3em)
    *Kita + Chromium*
  ],
  [
    #box(stroke: 0.5pt + luma(180), image("./assets/typst.pdf", height: 80%))
    #v(-0.3em)
    *typst*
  ],
)

// ---------------------------------------------------------------------------
= Benchmarks

== Benchmark

// p50 in ms: engine = nur Layout-PDF, total = inkl. Berechnung + @e-invoice-eu/core
#let results = (
  (name: "Kita + Chromium", engine: 182.2, total: 344.8, label: "344,8"),
  (name: "typst (WASM)", engine: 13.5, total: 110.0, label: "110,0"),
)

#grid(
  columns: (1fr, 1.15fr),
  gutter: 1.5em,
  [
    *PDF: Median-Renderzeit* (ms)
    #v(0.6em)
    #for r in results {
      let scale = 100% / 345 * 0.72
      grid(
        columns: (7.5em, 1fr),
        align: horizon,
        gutter: 0.5em,
        text(size: 0.8em, r.name),
        stack(
          dir: ltr,
          rect(width: r.engine * scale, height: 1.3em, fill: if r.engine > 20 { luma(150) } else { accent }),
          rect(width: (r.total - r.engine) * scale, height: 1.3em, fill: rgb("#00a49f").lighten(55%)),
          h(0.4em),
          text(size: 0.8em)[*#r.label*],
        ),
      )
      v(0.4em)
    }
    #v(0.3em)
    #text(size: 0.7em)[
      #box(rect(width: 0.8em, height: 0.8em, fill: luma(150))) #box(rect(width: 0.8em, height: 0.8em, fill: accent)) Engine
      #h(1em)
      #box(rect(width: 0.8em, height: 0.8em, fill: rgb("#00a49f").lighten(55%))) E-Rechnung
    ]
    #v(0.3em)
    #text(
      size: 0.7em,
    )[Je 50 Iterationen nach 10 Warm-up, sequentiell. PDF inkl. Berechnung, CII-XML und PDF/A-3b-Nachbearbeitung.]
  ],
  [
    #set text(size: 14pt)
    #table(
      columns: (auto, 1fr, 1fr),
      inset: 6pt,
      stroke: (_, y) => (bottom: if y == 0 { 1pt + accent } else { 0.4pt + luma(200) }),
      table.header([], [*Kita*], [*typst*]),
      table.cell(colspan: 3, text(size: 0.85em)[*PDF*]),
      [p50 / p95], [344,8 / 361,7 ms], [*110,0 / 125,3 ms*],
      [nur Engine], [182,2 ms], [*13,5 ms*],
      [Durchsatz], [3 /s], [*9 /s*],
      [Größe], [115 KB], [*39 KB*],
      table.cell(colspan: 3, text(size: 0.85em)[*HTML*]),
      [p50], [*0,02 ms*], [3,8 ms],
      [Durchsatz], [*\~44.000 /s*], [\~270 /s],
    )
  ],
)

#align(
  left,
)[
  #sym.arrow *HTML*: Kita ist *deutlich* schnelelr.
  
  #sym.arrow *PDF*: Engine *\~13$times$*, Ende-zu-Ende *\~3$times$ schneller*, *\~⅓ der Größe*.
]

// ---------------------------------------------------------------------------
= Fazit

== Fazit

#grid(
  columns: (1fr, 1fr),
  gutter: 1.5em,
  block(fill: soft, inset: 14pt, radius: 4pt, width: 100%)[
    *E-Mails* #sym.arrow *TSX (Kita)*
    - HTML ist das Zielformat (0,02 ms)
    - Typsicher, bekannte React-Syntax
    - Keine zusätzlichen Dependencies
    - Debugging im selben Prozess
  ],
  block(fill: rgb("#fde3e6"), inset: 14pt, radius: 4pt, width: 100%)[
    *PDFs* #sym.arrow *typst*
    - Engine \~13$times$, Ende-zu-Ende \~3$times$ schneller, \~⅓ der Größe
    - Kein Browser im Betrieb
    - PDF/A-3b nativ, Präziser Satz
    - Preis: neue Sprache, Lernkurve
  ],
)

#focus-slide[
  Den Code findet Ihr auf meinem Github:
  #qr-code("https://github.com/yagcioe/fisp-templating", background: komuno, color: white)
  #link("https://github.com/yagcioe/fisp-templating")[https://github.com/yagcioe/fisp-templating]
]

