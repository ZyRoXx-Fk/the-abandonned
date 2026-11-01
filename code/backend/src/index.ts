import { BusinessDraftService } from './services/business-draft.service.js';
import { PublicationService } from './services/publication.service.js';
import { DiscoveryService } from './services/discovery.service.js';
import { ActionProposalService } from './services/action-proposal.service.js';
import { ActionCommitService } from './services/action-commit.service.js';
import { ReservationAmendmentService } from './services/reservation-amendment.service.js';
import { auditService } from './services/audit.service.js';
import mongoose from 'mongoose';
import { MongoCatalogRepository } from './repositories/catalog.repository.js';
import { MongoProposalRepository } from './repositories/proposal.repository.js';
import { MongoTransactionRepository } from './repositories/transaction.repository.js';
import { MongoUnitOfWork } from './repositories/unit-of-work.js';
import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import dotenv from "dotenv";
import { connectDatabase, disconnectDatabase, isDatabaseConnected } from "./config/database.js";
import { authRoutes } from "./routes/auth.routes.js";
import { linkTokenRoutes } from "./routes/link-token.routes.js";
import { mcpRoutes } from "./routes/mcp.routes.js";
import { McpService } from "./services/mcp.service.js";
import { McpController } from "./controllers/mcp.controller.js";
import { McpSessionManager } from "./utils/managers/mcp-session.manager.js";
import { LinkTokenService } from "./services/link-token.service.js";
import { LinkTokenRepository } from "./repositories/link-token.repository.js";
import { LinkTokenController } from "./controllers/link-token.controller.js";
import { frontendOrigins } from "./config/auth.js";

dotenv.config();

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || "0.0.0.0";

export async function buildApp() {
  const app = Fastify({
    logger: { redact: ["req.body", "body", "token", "req.headers.authorization", "req.headers.cookie"] },
    trustProxy: false,
  });

  await app.register(cors, {
    origin: frontendOrigins(),
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
  });

  await app.register(cookie);
  await app.register(rateLimit, { global: false });

  app.get("/health", async () => {
    return {
      status: "ok",
      database: isDatabaseConnected() ? "connected" : "disconnected",
      timestamp: new Date().toISOString(),
      service: "the-abandonned-backend",
      version: "1.0.0",
    };
  });

  await app.register(authRoutes, { prefix: "/api/auth" });
  const sessions = new McpSessionManager();
  const pairing = new LinkTokenService(new LinkTokenRepository(), sessions);
  const catalog = new MongoCatalogRepository(mongoose.connection);
  const proposals = new MongoProposalRepository(mongoose.connection);
  const transactions = new MongoTransactionRepository(mongoose.connection);
  const uow = new MongoUnitOfWork(mongoose.connection);
  const mcp = new McpService(sessions, pairing, {
    drafts: new BusinessDraftService(catalog), publication: new PublicationService(catalog, proposals, transactions, uow),
    discovery: new DiscoveryService(catalog, transactions), actionProposals: new ActionProposalService(catalog, proposals),
    actionCommit: new ActionCommitService(catalog, proposals, transactions, uow),
    amendments: new ReservationAmendmentService(catalog, proposals, transactions), audit: auditService,
  });
  await app.register(linkTokenRoutes, { prefix: "/api/auth/link-token", controller: new LinkTokenController(pairing) });
  await app.register(mcpRoutes, { controller: new McpController(mcp), service: mcp });

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
