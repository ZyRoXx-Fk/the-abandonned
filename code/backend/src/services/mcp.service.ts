import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { mcpSessionManager, McpSessionManager } from "../utils/managers/mcp-session.manager.js";
import { linkTokenService, LinkTokenService } from "./link-token.service.js";
import { businessRepository, BusinessRepository } from "../repositories/business.repository.js";
import { auditService, AuditService } from "./audit.service.js";
import {
  linkOwnerSessionInputShape,
  LinkOwnerSessionDTO,
  LinkOwnerSessionResultDTO,
} from "../schemas/mcp.schema.js";
import { auditWebsiteInputShape } from "../schemas/audit.schema.js";
import { randomUUID } from "crypto";
import { ServerResponse, IncomingMessage } from "http";

export class McpService {
  private server: McpServer;
  private transport: StreamableHTTPServerTransport;
  private initPromise: Promise<void> | null = null;

  constructor(
    private readonly sessionManager: McpSessionManager = mcpSessionManager,
    private readonly linkTokens: LinkTokenService = linkTokenService,
    private readonly businessRepo: BusinessRepository = businessRepository,
    private readonly auditor: AuditService = auditService
  ) {
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
    this.setupTools();

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

  private setupTools(): void {
    this.server.tool(
      "link_owner_session",
      "Links the current AI agent session to the certified business owner account on the web platform using the link token (e.g. TRUST-9B3C2A).",
      linkOwnerSessionInputShape,
      async (args, extra) => {
        try {
          const result = await this.linkOwnerSession(args, extra.sessionId);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        } catch (error: any) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: error?.message || "Error linking owner session",
              },
            ],
          };
        }
      }
    );

    this.server.tool(
      "audit_website",
      "Audits the legacy restaurant website, detects outdated structure (legacy), identifies missing data for AI agents (terrace, pets, seating capacity), and proposes a draft MCP profile.",
      auditWebsiteInputShape,
      async (args) => {
        try {
          const result = await this.auditor.auditWebsite(args);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        } catch (error: any) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: error?.message || "Error auditing restaurant website",
              },
            ],
          };
        }
      }
    );
  }

  async linkOwnerSession(
    args: LinkOwnerSessionDTO,
    contextSessionId?: string
  ): Promise<LinkOwnerSessionResultDTO> {
    const normalizedToken = args.token.trim().toUpperCase();
    const consumptionResult = await this.linkTokens.validateAndConsume(normalizedToken);

    const effectiveSessionId = args.sessionId || contextSessionId || null;
    if (effectiveSessionId) {
      this.sessionManager.setSessionOwner(effectiveSessionId, consumptionResult.owner.id);
    }

    const businesses = await this.businessRepo.findAllByOwnerId(consumptionResult.owner.id);
    const formattedBusinesses = businesses.map((b) => ({
      id: b._id.toString(),
      name: b.name,
      trustStatus: b.trustStatus,
    }));

    const businessNotice =
      formattedBusinesses.length > 0
        ? `Associated business(es): ${formattedBusinesses.map((b) => `${b.name} (${b.trustStatus})`).join(", ")}.`
        : "No registered business yet. You can audit your current website using the 'audit_website' tool or configure your profile with 'save_business_profile'.";

    return {
      success: true,
      message: `Session successfully certified for ${consumptionResult.owner.firstName} ${consumptionResult.owner.lastName}. ${businessNotice}`,
      owner: consumptionResult.owner,
      businesses: formattedBusinesses,
      sessionId: effectiveSessionId,
    };
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
