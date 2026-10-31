import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { mcpSessionManager, McpSessionManager } from "../utils/managers/mcp-session.manager.js";
import { linkTokenService, LinkTokenService } from "./link-token.service.js";
import { businessRepository, BusinessRepository } from "../repositories/business.repository.js";
import {
  linkOwnerSessionInputShape,
  LinkOwnerSessionDTO,
  LinkOwnerSessionResultDTO,
} from "../schemas/mcp.schema.js";
import { randomUUID } from "crypto";
import { ServerResponse, IncomingMessage } from "http";

export class McpService {
  private server: McpServer;
  private transport: StreamableHTTPServerTransport;
  private initPromise: Promise<void> | null = null;

  constructor(
    private readonly sessionManager: McpSessionManager = mcpSessionManager,
    private readonly linkTokens: LinkTokenService = linkTokenService,
    private readonly businessRepo: BusinessRepository = businessRepository
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
      "Lie la session courante du restaurateur à son compte certifié sur la plateforme web via son token de liaison (ex: TRUST-9B3C2A).",
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
                text: error?.message || "Erreur lors de la liaison de la session propriétaire",
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
        ? `Établissement(s) associé(s) : ${formattedBusinesses.map((b) => `${b.name} (${b.trustStatus})`).join(", ")}.`
        : "Aucun établissement enregistré pour le moment. Vous pouvez auditer votre site web actuel avec l'outil 'audit_website' ou configurer votre profil avec 'save_business_profile'.";

    return {
      success: true,
      message: `Session certifiée avec succès pour ${consumptionResult.owner.firstName} ${consumptionResult.owner.lastName}. ${businessNotice}`,
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
