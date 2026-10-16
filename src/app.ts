import { fastifyAwilixPlugin } from "@fastify/awilix";
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
import { createAppContainer } from "./container.ts";
import { benchmarkRoute } from "./routes/benchmark.route.ts";
import { enginesRoute } from "./routes/engines.route.ts";
import { renderRoute } from "./routes/render.route.ts";

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
export async function buildApp(
  opts: FastifyServerOptions = {},
) {
  const app = Fastify(opts).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(fastifySwagger, {
    openapi: {
      openapi: "3.1.0",
      info: {
        title: "Template engine comparison",
        description: "Renders EN 16931 invoices as ZUGFeRD / Factur-X PDFs with interchangeable template engines (TSX + Chromium, typst).",
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

  // Services come from the DI container (see container.ts). asyncInit warms up
  // the engines (WASM + fonts, Chromium) before the app is ready; asyncDispose
  // and disposeOnClose shut them down with the app.
  await app.register(fastifyAwilixPlugin, {
    container: createAppContainer(),
    asyncInit: true,
    asyncDispose: true,
    disposeOnClose: true,
  });

  // Each endpoint is its own plugin; they inherit the zod compilers set above,
  // resolve their services from app.diContainer and are all picked up by the
  // swagger spec.
  await app.register(enginesRoute);
  await app.register(renderRoute);
  await app.register(benchmarkRoute);

  return app;
}
