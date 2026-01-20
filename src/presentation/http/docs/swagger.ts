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
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
          },
        },
      },
      security: [{ bearerAuth: [] }],
    },

    // ✅ pega arquivos em subpastas (routes/**) + funciona em dev (src) e build (dist)
    apis: [
      // DEV (ts)
      path.join(process.cwd(), "src/presentation/http/routes/**/*.ts"),
      path.join(process.cwd(), "src/presentation/http/controllers/**/*.ts"),

      // BUILD (js) - quando rodar pelo dist
      path.join(process.cwd(), "dist/presentation/http/routes/**/*.js"),
      path.join(process.cwd(), "dist/presentation/http/controllers/**/*.js"),
    ],
  };

  const swaggerSpec = swaggerJsdoc(options);

  app.use("/swagger", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
}
