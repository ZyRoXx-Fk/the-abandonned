import { FastifyInstance } from "fastify";
import { mcpController } from "../controllers/mcp.controller.js";

export async function mcpRoutes(app: FastifyInstance): Promise<void> {
  // Main Streamable HTTP MCP endpoint (handles GET for SSE streaming and POST for JSON-RPC messages)
  app.all("/mcp", mcpController.handleRequest);

  // SSE endpoint alias for MCP clients requesting /sse
  app.all("/sse", mcpController.handleRequest);

  // Messages endpoint alias for legacy clients posting to /messages
  app.all("/messages", mcpController.handleRequest);

  // Status and observability endpoint
  app.get("/mcp/status", mcpController.getStatus);
}

