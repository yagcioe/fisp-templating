import type { TemplateEngine } from "./core.ts";
import { sampleData } from "./models/dto/examples.ts";
import type { BenchmarkEngineResult, BenchmarkResult, InvoiceData } from "./models/dto/types.ts";

export interface BenchmarkOptions {
  iterations: number;
  warmup: number;
  data?: InvoiceData;
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

async function benchmarkEngine(engine: TemplateEngine, { iterations, warmup, data = sampleData }: BenchmarkOptions) {
  // Warm-up so JIT / first-compile caches don't skew the numbers.
  for (let i = 0; i < warmup; i++) await engine.render(data);

  const times: number[] = [];
  let output: Uint8Array = new Uint8Array();
  for (let i = 0; i < iterations; i++) {
    const t = performance.now();
    output = await engine.render(data);
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  const pct = (p: number) => times[Math.min(times.length - 1, Math.floor(p * times.length))]!;
  const mean = times.reduce((a, b) => a + b, 0) / times.length;

  return {
    engine: engine.name,
    meanMs: round3(mean),
    p50Ms: round3(pct(0.5)),
    p95Ms: round3(pct(0.95)),
    minMs: round3(times[0]!),
    maxMs: round3(times.at(-1)!),
    opsPerSec: Math.round(1000 / mean),
    outputBytes: output.byteLength,
  } satisfies BenchmarkEngineResult;
}

/** Benchmarks the given (already initialized) engines one after another. */
export async function runBenchmark(engines: Iterable<TemplateEngine>, options: BenchmarkOptions): Promise<BenchmarkResult> {
  const results: BenchmarkEngineResult[] = [];
  for (const engine of engines) results.push(await benchmarkEngine(engine, options));
  return { iterations: options.iterations, warmup: options.warmup, results };
}
