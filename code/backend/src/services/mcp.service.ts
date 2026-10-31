import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { mcpSessionManager, McpSessionManager } from "../utils/managers/mcp-session.manager.js";
import { randomUUID } from "crypto";
import { ServerResponse, IncomingMessage } from "http";

export class McpService {
  private server: McpServer;
  private transport: StreamableHTTPServerTransport;
  private initPromise: Promise<void> | null = null;

  constructor(private readonly sessionManager: McpSessionManager = mcpSessionManager) {
    this.server = new McpServer(
      {
        name: "the-abandonned",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
          resources: {},
          prompts: {},
        },
      }
    );

    this.setupResources();

    this.transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sessionId: string) => {
        this.sessionManager.registerSession(sessionId);
      },
      onsessionclosed: (sessionId: string) => {
        this.sessionManager.removeSession(sessionId);
      },
    });
  }

  private setupResources(): void {
    this.server.resource(
      "system-health",
      "system://health",
      async (uri) => ({
        contents: [
          {
            uri: uri.href,
            text: JSON.stringify({
              status: "operational",
              service: "the-abandonned-mcp-server",
              timestamp: new Date().toISOString(),
            }),
          },
        ],
      })
    );
  }

  async init(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.server.connect(this.transport);
    }
    await this.initPromise;
  }

  getServer(): McpServer {
    return this.server;
  }

  getTransport(): StreamableHTTPServerTransport {
    return this.transport;
  }

  async handleRequest(
    req: IncomingMessage,
    res: ServerResponse,
    parsedBody?: unknown
  ): Promise<void> {
    await this.init();
    await this.transport.handleRequest(req, res, parsedBody);
  }

  getSession(sessionId: string) {
    return this.sessionManager.getSession(sessionId);
  }

  getStatus() {
    return {
      status: "running",
      protocol: "model-context-protocol",
      transport: "StreamableHTTP",
      version: "1.0.0",
      activeSessions: this.sessionManager.getActiveCount(),
      sessions: this.sessionManager.getAllSessions(),
    };
  }
}

export const mcpService = new McpService();

