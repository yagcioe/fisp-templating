import type { TemplateEngine } from "./core.ts";
import { sampleData } from "./models/dto/examples.ts";
import type { BenchmarkEngineResult, BenchmarkResult, InvoiceData, OutputFormat } from "./models/dto/types.ts";

export interface BenchmarkOptions {
  iterations: number;
  warmup: number;
  formats: OutputFormat[];
  data?: InvoiceData;
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

/** One render in the given format; returns the output size in bytes. */
async function renderOnce(engine: TemplateEngine, data: InvoiceData, format: OutputFormat): Promise<number> {
  if (format === "html") return Buffer.byteLength(await engine.render(data, "html"));
  return (await engine.render(data, "pdf")).byteLength;
}

async function benchmarkEngine(
  engine: TemplateEngine,
  format: OutputFormat,
  { iterations, warmup, data = sampleData }: BenchmarkOptions,
): Promise<BenchmarkEngineResult> {
  // Warm-up so JIT / first-compile caches don't skew the numbers.
  for (let i = 0; i < warmup; i++) await renderOnce(engine, data, format);

  const times: number[] = [];
  let outputBytes = 0;
  for (let i = 0; i < iterations; i++) {
    const t = performance.now();
    outputBytes = await renderOnce(engine, data, format);
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  const pct = (p: number) => times[Math.min(times.length - 1, Math.floor(p * times.length))]!;
  const mean = times.reduce((a, b) => a + b, 0) / times.length;

  return {
    engine: engine.name,
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
export async function runBenchmark(engines: Iterable<TemplateEngine>, options: BenchmarkOptions): Promise<BenchmarkResult> {
  const results: BenchmarkEngineResult[] = [];
  for (const engine of engines) {
    for (const format of options.formats) results.push(await benchmarkEngine(engine, format, options));
  }
  return { iterations: options.iterations, warmup: options.warmup, results };
}
