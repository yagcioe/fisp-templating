import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { ErrorResponseSchema, InvoiceDataSchema, OutputFormatSchema } from "../models/dto/schemas.ts";

/** POST /render/:engine */
export const renderRoute: FastifyPluginAsyncZod = async (app) => {
  const { engineNames } = app.diContainer.resolve("templateService");
  const invoiceService = app.diContainer.resolve("invoiceService");

  app.post(
    "/render/:engine",
    {
      schema: {
        summary: "Render an invoice",
        description:
          "Renders the invoice with the chosen engine: returns a ZUGFeRD / Factur-X (EN 16931) PDF/A-3b, `format=html` " +
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
      const { engine } = req.params;
      const start = performance.now();
      if (req.query.format === "html") {
        const html = await invoiceService.generateHtmlInvoice(req.body, engine);
        reply.header("x-render-time-ms", (performance.now() - start).toFixed(3));
        return reply.type("text/html; charset=utf-8").send(html);
      }
      const pdf = await invoiceService.generatePdfInvoice(req.body, engine);
      reply.header("x-render-time-ms", (performance.now() - start).toFixed(3));

      // Sent as attachment: clients get a proper filename, and Swagger UI only
      // offers a binary download link for attachments (it shows other non-text
      // bodies as corrupted text).
      const filename = `${req.body.number}-${engine}.pdf`.replace(/[^\w.-]+/g, "_");
      reply.header("content-disposition", `attachment; filename="${filename}"`);
      // Binary bodies are documented as `format: binary` strings; the type
      // provider can only type them as `string`, so the Buffer needs a cast.
      const body = Buffer.from(pdf.buffer, pdf.byteOffset, pdf.byteLength);
      return reply.type("application/pdf").send(body as unknown as string);
    },
  );
};
