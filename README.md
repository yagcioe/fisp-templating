# Template engine comparison: Kita (TSX + Chromium) vs. typst (typst-wasm)

A Fastify server accepts an EN 16931 invoice as JSON `POST` and returns a
**ZUGFeRD 2.x / Factur-X (profile EN 16931) PDF/A-3b** e-invoice produced by one
of two interchangeable template engines. Both render the same invoice from the
same data model and go through the same ZUGFeRD finishing step.

```
src/
  models/dto/
    schemas.ts         zod schemas of the EN 16931 invoice payload
    types.ts           DTO types inferred from the schemas + calculated view model
    examples.ts        sample invoice (benchmark + Swagger example)
  core.ts              calculation + business rules, TemplateEngine contract
  tsx/kitajs.tsx       @kitajs/html TSX → HTML (→ PDF via headless Chromium / Puppeteer)
  typst/typst-wasm.ts  typst-wasm – .typ template → PDF/A-3b or HTML (WASM, worker thread)
  typst/templates/     the typst invoice template
  zugferd/index.ts     shared pipeline: XML → engine PDF → PDF/A-3b finishing
  zugferd/cii.ts       CII XML (factur-x.xml) generator
  zugferd/pdfa.ts      PDF/A-3b + Factur-X XMP finishing step (pdf-lib)
  zugferd/xml.ts       XML escaping shared by the CII and XMP builders
  zugferd/sRGB-v4.icc  compact sRGB ICC profile (CC0) for the PDF/A output intent
  engines.ts           registers both engines
  app.ts               Fastify app: routes + OpenAPI (swagger) setup
  server.ts            entry point: warms up engines, starts the server
  benchmark.ts         benchmark runner behind POST /benchmark
```

Both modules implement the same interface from `src/core.ts`:

```ts
interface TemplateEngine {
  name: string;
  init?(): Promise<void>;          // typst: loads WASM + fonts, kitajs: launches Chromium
  render(data: InvoiceData, format: "pdf"): Promise<Uint8Array>;  // ZUGFeRD PDF
  render(data: InvoiceData, format: "html"): Promise<string>;     // plain HTML, no e-invoice data
  close?(): Promise<void>;         // typst: stops the worker, kitajs: closes Chromium
}
```

Each engine runs `calculateInvoice(data)` first, which applies the EN 16931
calculation rules (line amounts, VAT breakdown per category/rate, totals) and
checks the business rules the schema can't express (e.g. BR-CO-25: due date
or payment terms required, BR-CO-26: seller VAT id required). Violations return
`400` with the rule id.

## Usage

```sh
npm install
npm start                 # http://localhost:3000 (PORT env to change)
npm run typecheck
npm run build             # compiles to dist/ (tsconfig.build.json) + copies .typ/.icc assets
npm run start:prod        # runs the compiled server: node dist/server.js
```

```sh
curl -X POST localhost:3000/render/kitajs -H "content-type: application/json" --data @sample.json > kita.pdf
curl -X POST localhost:3000/render/typst  -H "content-type: application/json" --data @sample.json > typst.pdf
curl -X POST "localhost:3000/render/typst?format=html" -H "content-type: application/json" --data @sample.json > typst.html
curl localhost:3000/engines
curl -X POST localhost:3000/benchmark -H "content-type: application/json" -d '{"iterations": 20}'
```

`POST /benchmark` runs the benchmark on the live engines and returns the timings
as JSON, one result per engine and format. All body fields are optional:
`iterations` (default 20, max 1000), `warmup` (default 10), `formats` (`pdf`,
`html`; default both), `engines` (default all) and `invoice` (default the sample
invoice). Only one benchmark runs at a time (`409` otherwise), and render traffic
running at the same time skews the numbers.

The body is validated against the zod schema `InvoiceDataSchema` (src/models/dto/schemas.ts,
also the source of the TypeScript types); each response carries an
`x-render-time-ms` header with the full render time (calculation, XML, layout,
PDF/A finishing).

## Docker

```sh
docker compose up --build          # http://localhost:3000, HOST_PORT=3300 to change
# or
docker build -t fisp-templating .
docker run --init -p 3000:3000 fisp-templating
```

The Dockerfile has two stages, both on `node:24-bookworm-slim`:

- **build**: installs all dependencies, runs `npm run typecheck` and
  `npm run build`, then prunes the dev dependencies.
- **runtime** (~900 MB, mostly Chrome): only `dist/`, the production
  `node_modules`, Chrome for Testing plus its system libraries (via
  `puppeteer browsers install --install-deps`) and Liberation fonts for the Kita
  PDFs. No TypeScript sources, tsx or compiler.

Notes:

- The server runs as the unprivileged `node` user with plain `node dist/server.js`.
  It listens on `HOST=0.0.0.0` inside the container and shuts down cleanly on
  `SIGTERM` (closing Chromium).
- Chromium runs with `--no-sandbox` (`PUPPETEER_ARGS`), because its sandbox
  needs user namespaces that Docker's default seccomp profile blocks. It only
  renders the app's own HTML with escaped user input.
- Use `--init` (compose sets `init: true`) so Chromium's child processes are reaped.
- A `HEALTHCHECK` polls `/engines`.

## OpenAPI

The running server generates the spec from the routes' zod schemas at startup
(via `fastify-type-provider-zod` + `@fastify/swagger`); schemas with a
`.meta({ id })` become `components`, `.describe()` texts become field
descriptions.

- Swagger UI at `/docs`, raw spec at `/docs/json` and `/docs/yaml`
- "Try it out" is enabled and pre-filled with the sample invoice
  (`src/models/dto/examples.ts`, attached via `examples` on `InvoiceDataSchema`),
  so *Execute* works as is

## How the ZUGFeRD PDF is built

1. `buildCiiXml()` turns the calculated invoice into a UN/CEFACT Cross Industry
   Invoice with guideline `urn:cen.eu:en16931:2017`.
2. The engine lays out the visual PDF:
   - **typst** gets the invoice JSON and the XML via `sys.inputs` and embeds the
     XML itself with `pdf.attach("factur-x.xml", …, relationship: "alternative")`.
   - **kitajs** renders HTML with Kita and prints it with headless Chromium
     (`page.pdf()`); the HTML is only an intermediate and never returned.
3. Finishing (pdf-lib), depending on what the engine produced:
   - **typst** already writes PDF/A-3b (`pdfStandards: ["a3b"]`) with the XML
     attached and all document metadata from the template's `set document`
     (title, author, description, date). `addFacturXMetadata()` only injects the
     Factur-X XMP properties (`fx:DocumentType`, `DocumentFileName`, `Version`,
     `ConformanceLevel` EN 16931) and their extension-schema declaration, which
     typst cannot express; everything else stays untouched.
   - **kitajs** (Chromium) gets the full `finalizeFacturX()` conversion: embeds
     `factur-x.xml`, sets `/AFRelationship /Alternative` and the catalog `/AF`
     array, adds an sRGB output intent (bundled ICC profile), ensures a trailer
     `/ID` and writes XMP with `pdfaid` 3B plus the Factur-X fields and a
     matching Info dictionary.

Both engines' output is verified with the [Mustang](https://www.mustangproject.org/)
validator (veraPDF PDF/A-3b + EN 16931 schematron):

```sh
java -jar Mustang-CLI.jar --action validate --source out.pdf
```

## Notes for the comparison

- **typst-wasm** runs the typst compiler in a worker thread. The WASM modules
  and fonts (Libertinus Serif from `@typst-wasm/fonts`) are loaded from
  `node_modules` in `init()`, so no network access is needed. In WASM typst has
  no clock, so the template sets the document date from the issue date (PDF/A
  requires one). That date ends up as the PDF's creation date.
- **Kita** is plain string concatenation (user strings escaped via the `safe`
  attribute); the PDF layout is done by Chromium, launched once in `init()`.
  Puppeteer downloads its own Chrome in its `npm install` postinstall script
  (~150 MB). Newer npm versions may skip install scripts until approved; then
  run `npx puppeteer browsers install chrome` once. Each render opens a page, so
  renders run concurrently, but it is slower and the PDFs are bigger (system
  fonts embedded) than typst's.
- Layout differences come from the layout engines: CSS print layout in Chromium
  vs. typst's own typesetting (fonts: system serif vs. Libertinus Serif).
