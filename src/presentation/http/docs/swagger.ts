// src/presentation/http/docs/swagger.ts
import swaggerJsdoc, { Options } from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";
import { Express } from "express";

export function setupSwagger(app: Express) {
  const options: Options = {
    definition: {
      openapi: "3.0.0",
      info: {
        title: "Looma API",
        version: "1.0.0",
        description: "API do Influenciador"
      },
      servers: [
        {
          url: "http://localhost:7031",
          description: "Dev"
        }
      ],
      components: {
        securitySchemes: {
          Bearer: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT"
          }
        }
      },
      security: [{ Bearer: [] }]
    },
    apis: [
      "src/presentation/http/routes/*.ts",
      "src/presentation/http/controllers/*.ts"
    ]
  };

  const swaggerSpec = swaggerJsdoc(options);
  app.use("/swagger", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
}
