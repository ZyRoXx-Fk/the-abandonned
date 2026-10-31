import Fastify from "fastify";
import cors from "@fastify/cors";
import dotenv from "dotenv";

dotenv.config();

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || "0.0.0.0";
const frontendUrl = process.env.FRONTEND_URL || "http://localhost:4321";

export async function buildApp() {
  const app = Fastify({
    logger: true,
  });

  // Enable CORS for web frontend
  await app.register(cors, {
    origin: [frontendUrl, "http://localhost:3000", "http://127.0.0.1:3000"],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
  });

  // Healthcheck endpoint
  app.get("/health", async () => {
    return {
      status: "ok",
      timestamp: new Date().toISOString(),
      service: "the-abandonned-backend",
      version: "1.0.0",
    };
  });

  return app;
}

async function start() {
  try {
    const app = await buildApp();
    await app.listen({ port, host });
    app.log.info(`Server ready and listening at http://${host}:${port}`);
  } catch (err) {
    console.error("Error starting server:", err);
    process.exit(1);
  }
}

// Start server when run directly
if (process.env.NODE_ENV !== "test") {
  start();
}
