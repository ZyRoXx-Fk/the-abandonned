import { FastifyInstance } from "fastify";
import { authController, AuthController } from "../controllers/auth.controller.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import { protectAuthOrigin } from "../config/auth.js";

export async function authRoutes(app: FastifyInstance, options: { controller?: AuthController } = {}): Promise<void> {
  const controller = options.controller || authController;
  const limited = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };
  app.addHook("onRequest", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    return protectAuthOrigin(request, reply);
  });

  // Public registration & login endpoints
  app.post("/owners/register", limited, controller.registerOwner);
  app.post("/clients/register", limited, controller.registerClient);
  app.post("/owners/login", limited, controller.loginOwner);
  app.post("/clients/login", limited, controller.loginClient);
  app.post("/login", limited, controller.login);
  app.post("/logout", controller.logout);

  // Protected endpoints accept the browser session cookie or an API Bearer token.
  app.get("/me", { preHandler: [authenticate] }, controller.getMe);
  app.put("/clients/preferences", { preHandler: [authenticate] }, controller.updateClientPreferences);
}
