import { buildApp } from "./app.ts";

const app = await buildApp({ logger: true });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    app.log.info(`${signal} received, shutting down`);
    await app.close();
    process.exit(0);
  });
}

await app.listen({ host: process.env.HOST ?? "localhost", port: Number(process.env.PORT ?? 3000) });
