import { FastifyInstance } from "fastify";
import { authController } from "../controllers/auth.controller.js";
import { authenticate } from "../middlewares/auth.middleware.js";

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // Public registration & login endpoints
  app.post("/owners/register", authController.registerOwner);
  app.post("/clients/register", authController.registerClient);
  app.post("/login", authController.login);

  // Protected endpoints requiring Bearer token
  app.get("/me", { preHandler: [authenticate] }, authController.getMe);
  app.put("/clients/preferences", { preHandler: [authenticate] }, authController.updateClientPreferences);
}
