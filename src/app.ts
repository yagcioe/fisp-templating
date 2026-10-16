import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import Fastify, { type FastifyServerOptions } from "fastify";
import {
  jsonSchemaTransform,
  jsonSchemaTransformObject,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { z } from "zod";
import { runBenchmark } from "./benchmark.ts";
import type { TemplateEngine } from "./core.ts";
import {
  BenchmarkRequestSchema,
  BenchmarkResultSchema,
  ErrorResponseSchema,
  InvoiceDataSchema,
  OutputFormatSchema,
} from "./models/dto/schemas.ts";

type SpecShape = {
  paths?: Record<string, Record<string, { requestBody?: { content?: Record<string, { schema?: { $ref?: string }; example?: unknown }> } }>>;
  components?: { schemas?: Record<string, { examples?: unknown[] }> };
};

/**
 * Copies the first `examples` entry of a request body's referenced component
 * onto the media type, where Swagger UI reliably uses it as the "Example Value"
 * and to pre-fill "Try it out".
 */
function inlineRequestExamples<T>(spec: T): T {
  const { paths = {}, components } = spec as SpecShape;
  for (const operations of Object.values(paths)) {
    for (const operation of Object.values(operations)) {
      for (const media of Object.values(operation.requestBody?.content ?? {})) {
        const component = media.schema?.$ref?.split("/").pop();
        const example = component ? components?.schemas?.[component]?.examples?.[0] : undefined;
        if (example !== undefined) media.example ??= example;
      }
    }
  }
  return spec;
}

/**
 * Builds the Fastify app. The OpenAPI spec is generated from the routes' zod
 * schemas; it is served at /docs (Swagger UI), /docs/json and /docs/yaml.
 */
export async function buildApp(engines: Map<string, TemplateEngine>, opts: FastifyServerOptions = {}) {
  const app = Fastify(opts).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(fastifySwagger, {
    openapi: {
      openapi: "3.1.0",
      info: {
        title: "Template engine comparison",
        description: "Renders EN 16931 invoices as ZUGFeRD / Factur-X PDFs with interchangeable template engines (Kita + Chromium, typst).",
        version: "1.0.0",
      },
    },
    transform: jsonSchemaTransform,
    transformObject: (doc) => inlineRequestExamples(jsonSchemaTransformObject(doc)),
  });
  await app.register(fastifySwaggerUi, {
    routePrefix: "/docs",
    // Request editors open directly, pre-filled with the sample invoice.
    uiConfig: { tryItOutEnabled: true, displayRequestDuration: true },
  });

  const engineNames = [...engines.keys()] as [string, ...string[]];

  app.get(
    "/engines",
    {
      schema: {
        summary: "List available template engines",
        response: { 200: z.array(z.enum(engineNames)) },
      },
    },
    async () => engineNames,
  );

  app.post(
    "/render/:engine",
    {
      schema: {
        summary: "Render an invoice",
        description:
          "Renders the invoice with the chosen engine: `kitajs` (Kita HTML, printed by headless Chromium for PDF) " +
          "or `typst`. `format=pdf` (default) returns a ZUGFeRD / Factur-X (EN 16931) PDF/A-3b, `format=html` " +
          "the engine's HTML (no e-invoice data). The `x-render-time-ms` response header carries the full " +
          "render time (calculation, XML, layout, PDF/A finishing).",
        params: z.object({ engine: z.enum(engineNames).meta({ examples: [engineNames.at(-1)!] }) }),
        querystring: z.object({ format: OutputFormatSchema.default("pdf") }),
        body: InvoiceDataSchema,
        response: {
          200: {
            description: "PDF sent as attachment `<invoice number>-<engine>.pdf`, or HTML.",
            content: {
              "application/pdf": { schema: z.string().meta({ format: "binary" }) },
              "text/html": { schema: z.string() },
            },
          },
          400: ErrorResponseSchema.describe("Schema validation failed or a business rule (BR-*) was violated."),
        },
      },
    },
    async (req, reply) => {
      const engine = engines.get(req.params.engine)!;
      const start = performance.now();
      if (req.query.format === "html") {
        const html = await engine.render(req.body, "html");
        reply.header("x-render-time-ms", (performance.now() - start).toFixed(3));
        return reply.type("text/html; charset=utf-8").send(html);
      }
      const pdf = await engine.render(req.body, "pdf");
      reply.header("x-render-time-ms", (performance.now() - start).toFixed(3));

      // Sent as attachment: clients get a proper filename, and Swagger UI only
      // offers a binary download link for attachments (it shows other non-text
      // bodies as corrupted text).
      const filename = `${req.body.number}-${engine.name}.pdf`.replace(/[^\w.-]+/g, "_");
      reply.header("content-disposition", `attachment; filename="${filename}"`);
      // Binary bodies are documented as `format: binary` strings; the type
      // provider can only type them as `string`, so the Buffer needs a cast.
      const body = Buffer.from(pdf.buffer, pdf.byteOffset, pdf.byteLength);
      return reply.type("application/pdf").send(body as unknown as string);
    },
  );

  // Benchmarks measure the shared engines in-process; overlapping runs would
  // skew each other, so only one runs at a time.
  let benchmarkRunning = false;

  app.post(
    "/benchmark",
    {
      schema: {
        summary: "Run the render benchmark",
        description:
          "Renders the invoice `warmup + iterations` times per engine and format (sequentially) and reports " +
          "timings, one result per engine and format. " +
          "Runs on the live engines, so concurrent render traffic affects the numbers. " +
          "Kita (Chromium) is several times slower than typst, so keep `iterations` moderate.",
        body: BenchmarkRequestSchema.extend({
          engines: z.array(z.enum(engineNames)).min(1).optional().describe("Engines to benchmark; default: all"),
        }).meta({ examples: [{ iterations: 20, warmup: 5 }] }),
        response: {
          200: BenchmarkResultSchema,
          400: ErrorResponseSchema.describe("Invalid options or invoice."),
          409: ErrorResponseSchema.describe("Another benchmark is already running."),
        },
      },
    },
    async (req, reply) => {
      if (benchmarkRunning) {
        return reply.code(409).send({ statusCode: 409, error: "Conflict", message: "A benchmark is already running" });
      }
      benchmarkRunning = true;
      try {
        const { iterations, warmup, formats, engines: names = engineNames, invoice } = req.body;
        return await runBenchmark(
          names.map((name) => engines.get(name)!),
          { iterations, warmup, formats, data: invoice },
        );
      } finally {
        benchmarkRunning = false;
      }
    },
  );

  return app;
}
