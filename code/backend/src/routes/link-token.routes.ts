import { FastifyInstance } from "fastify";
import { linkTokenController } from "../controllers/link-token.controller.js";
import { authenticate } from "../middlewares/auth.middleware.js";

export async function linkTokenRoutes(app: FastifyInstance): Promise<void> {
  // Generate a link token for the authenticated owner
  app.post("/", { preHandler: [authenticate] }, linkTokenController.generateLinkToken);

  // Verify and consume a link token (e.g. from ChatGPT MCP or test client)
  app.post("/verify", linkTokenController.verifyLinkToken);
}
