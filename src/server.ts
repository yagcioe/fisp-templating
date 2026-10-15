import { buildApp } from "./app.ts";
import { loadEngines } from "./engines.ts";

const engines = await loadEngines();
const app = await buildApp(engines, { logger: true });
app.addHook("onClose", () => Promise.all([...engines.values()].map((e) => e.close?.())).then(() => {}));

// Close gracefully (incl. Chromium) on `docker stop` / Ctrl+C.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    app.log.info(`${signal} received, shutting down`);
    await app.close();
    process.exit(0);
  });
}

// HOST=0.0.0.0 is needed inside containers; localhost stays the safe default.
await app.listen({ host: process.env.HOST ?? "localhost", port: Number(process.env.PORT ?? 3000) });
