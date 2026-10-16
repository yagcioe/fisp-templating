import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { InvoiceService } from "../invoice/invoice.service.ts";
import { sampleData } from "../models/dto/examples.ts";
import { BenchmarkRequestSchema, BenchmarkResultSchema, ErrorResponseSchema } from "../models/dto/schemas.ts";
import type { BenchmarkEngineResult, BenchmarkResult, InvoiceData, OutputFormat } from "../models/dto/types.ts";
import type { TemplateEngineName } from "../templating/template.service.ts";

/** POST /benchmark */
export const benchmarkRoute: FastifyPluginAsyncZod = async (app) => {
  const { engineNames } = app.diContainer.resolve("templateService");
  const invoiceService = app.diContainer.resolve("invoiceService");

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
          "Runs on the live engines, so concurrent render traffic affects the numbers. ",
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
        const { iterations, warmup, formats, engines = engineNames, invoice } = req.body;
        return await runBenchmark(invoiceService, engines, { iterations, warmup, formats, data: invoice });
      } finally {
        benchmarkRunning = false;
      }
    },
  );
};

interface BenchmarkOptions {
  iterations: number;
  warmup: number;
  formats: OutputFormat[];
  data?: InvoiceData;
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

/** One render in the given format; returns the output size in bytes. */
async function renderOnce(
  invoiceService: InvoiceService,
  engine: TemplateEngineName,
  data: InvoiceData,
  format: OutputFormat,
): Promise<number> {
  if (format === "html") return Buffer.byteLength(await invoiceService.generateHtmlInvoice(data, engine));
  return (await invoiceService.generatePdfInvoice(data, engine)).byteLength;
}

async function benchmarkEngine(
  invoiceService: InvoiceService,
  engine: TemplateEngineName,
  format: OutputFormat,
  { iterations, warmup, data = sampleData }: BenchmarkOptions,
): Promise<BenchmarkEngineResult> {
  // Warm-up so JIT / first-compile caches don't skew the numbers.
  for (let i = 0; i < warmup; i++) await renderOnce(invoiceService, engine, data, format);

  const times: number[] = [];
  let outputBytes = 0;
  for (let i = 0; i < iterations; i++) {
    const t = performance.now();
    outputBytes = await renderOnce(invoiceService, engine, data, format);
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  const pct = (p: number) => times[Math.min(times.length - 1, Math.floor(p * times.length))]!;
  const mean = times.reduce((a, b) => a + b, 0) / times.length;

  return {
    engine,
    format,
    meanMs: round3(mean),
    p50Ms: round3(pct(0.5)),
    p95Ms: round3(pct(0.95)),
    minMs: round3(times[0]!),
    maxMs: round3(times.at(-1)!),
    opsPerSec: Math.round(1000 / mean),
    outputBytes,
  };
}

/** Benchmarks the given (already initialized) engines in each format, one after another. */
async function runBenchmark(
  invoiceService: InvoiceService,
  engines: Iterable<TemplateEngineName>,
  options: BenchmarkOptions,
): Promise<BenchmarkResult> {
  const results: BenchmarkEngineResult[] = [];
  for (const engine of engines) {
    for (const format of options.formats) results.push(await benchmarkEngine(invoiceService, engine, format, options));
  }
  return { iterations: options.iterations, warmup: options.warmup, results };
}
