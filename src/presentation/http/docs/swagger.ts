import swaggerJsdoc, { Options } from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";
import { Express } from "express";
import path from "path";

export function setupSwagger(app: Express) {
  const options: Options = {
    definition: {
      openapi: "3.0.0",
      info: {
        title: "Looma API",
        version: "1.0.0",
        description: "API do Influenciador",
      },
      servers: [
        {
          url: "http://localhost:7031",
          description: "Dev",
        },
      ],
      components: {
        securitySchemes: {
          // ✅ Nome padrão mais comum e compatível com @openapi: bearerAuth
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
          },
        },
      },
      // ✅ aplica por padrão (você pode sobrescrever por rota)
      security: [{ bearerAuth: [] }],
    },

    // ✅ paths absolutos para evitar problemas de glob em Windows
    apis: [
      path.join(process.cwd(), "src/presentation/http/routes/*.ts"),
      path.join(process.cwd(), "src/presentation/http/controllers/*.ts"),
      // se você tiver docs em outros lugares, pode adicionar aqui
    ],
  };

  const swaggerSpec = swaggerJsdoc(options);

  app.use("/swagger", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
}
