import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

/** GET /engines */
export const enginesRoute: FastifyPluginAsyncZod = async (app) => {
  const { engineNames } = app.diContainer.resolve("templateService");

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
};
