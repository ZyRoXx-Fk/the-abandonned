import Fastify from "fastify";
import cors from "@fastify/cors";
import dotenv from "dotenv";
import { connectDatabase, disconnectDatabase, isDatabaseConnected } from "./config/database.js";

dotenv.config();

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || "0.0.0.0";
const frontendUrl = process.env.FRONTEND_URL || "http://localhost:4321";

export async function buildApp() {
  const app = Fastify({
    logger: true,
  });

  await app.register(cors, {
    origin: [frontendUrl, "http://localhost:3000", "http://127.0.0.1:3000"],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
  });

  app.get("/health", async () => {
    return {
      status: "ok",
      database: isDatabaseConnected() ? "connected" : "disconnected",
      timestamp: new Date().toISOString(),
      service: "the-abandonned-backend",
      version: "1.0.0",
    };
  });

  return app;
}

async function start() {
  try {
    await connectDatabase();

    const app = await buildApp();
    await app.listen({ port, host });
    app.log.info(`Server ready and listening at http://${host}:${port}`);

    const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
    for (const signal of signals) {
      process.on(signal, async () => {
        app.log.info(`Received ${signal}. Shutting down gracefully...`);
        await app.close();
        await disconnectDatabase();
        process.exit(0);
      });
    }
  } catch (err) {
    console.error("Error starting server:", err);
    process.exit(1);
  }
}

if (process.env.NODE_ENV !== "test") {
  start();
}
