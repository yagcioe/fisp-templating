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
  zugferd/index.ts     shared pipeline: engine PDF → @e-invoice-eu/core (CII XML + PDF/A-3b)
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

The e-invoice part is done by [`@e-invoice-eu/core`](https://www.npmjs.com/package/@e-invoice-eu/core),
the library behind the [`@e-invoice-eu/cli`](https://www.npmjs.com/package/@e-invoice-eu/cli)
command line tool, used in-process (no child process per render).

1. The engine lays out the visual PDF:
   - **typst** gets the calculated invoice as CBOR and compiles with
     `pdfStandards: ["a3b"]`, so typst already enforces the PDF/A rules it
     controls (embedded fonts etc.). `sys.inputs` only carries strings, so the
     CBOR is written to a virtual file per render (`inputs/<uuid>.cbor`, removed
     afterwards) and the template reads it with `cbor(sys.inputs.data)`.
   - **kitajs** renders HTML with Kita and prints it with headless Chromium
     (`page.pdf()`); the HTML is only an intermediate and never returned.
2. `toEInvoice()` maps the calculated invoice onto the library's input format
   (UBL-style JSON, EN 16931 syntax binding; all numbers as strings, every
   amount with its `@currencyID`).
3. `InvoiceService.generate()` with format `Factur-X-EN16931` validates that
   JSON against the library's schema, converts it to a UN/CEFACT Cross
   Industry Invoice (guideline `urn:cen.eu:en16931:2017`), attaches it as
   `factur-x.xml` (`/AFRelationship /Alternative`, catalog `/AF`), adds an sRGB
   output intent and a trailer `/ID`, and writes the PDF/A-3b + Factur-X XMP
   metadata and Info dictionary (title, author, subject and creator are passed
   in as `customMetadata`).

Both engines' output is verified with the [Mustang](https://www.mustangproject.org/)
validator (veraPDF PDF/A-3b + EN 16931 schematron):

```sh
java -jar Mustang-CLI.jar --action validate --source out.pdf
```

## Notes for the comparison

- **typst-wasm** runs the typst compiler in a worker thread. The WASM modules
  and fonts (Libertinus Serif from `@typst-wasm/fonts`) are loaded from
  `node_modules` in `init()`, so no network access is needed. In WASM typst has
  no clock, so the template sets the document date from the issue date; the
  final PDF's dates are set by `@e-invoice-eu/core` at finishing time.
- **Kita** is plain string concatenation (user strings escaped via the `safe`
  attribute); the PDF layout is done by Chromium, launched once in `init()`.
  Puppeteer downloads its own Chrome in its `npm install` postinstall script
  (~150 MB). Newer npm versions may skip install scripts until approved; then
  run `npx puppeteer browsers install chrome` once. Each render opens a page, so
  renders run concurrently, but it is slower and the PDFs are bigger (system
  fonts embedded) than typst's.
- `@e-invoice-eu/core` compiles its JSON schema (Ajv) on every `generate()`
  call, which costs roughly 60–80 ms per PDF render for both engines and makes
  up most of typst's PDF time.
- Layout differences come from the layout engines: CSS print layout in Chromium
  vs. typst's own typesetting (fonts: system serif vs. Libertinus Serif).
