import { z } from "zod";

export const mcpMessageQuerySchema = z.object({
  sessionId: z.string().uuid("Invalid session UUID"),
});

export type McpMessageQueryDTO = z.infer<typeof mcpMessageQuerySchema>;

export interface McpSessionInfo {
  sessionId: string;
  ownerId: string | null;
  createdAt: Date;
  lastActiveAt: Date;
}

export const linkOwnerSessionInputShape = {
  token: z
    .string()
    .min(3, "Token must be at least 3 characters")
    .describe("The 6-character linking code received from the web dashboard (e.g. TRUST-XXXXXX)"),
  sessionId: z
    .string()
    .optional()
    .describe("Optional session UUID to link (defaults to the active MCP session)"),
};

export const linkOwnerSessionSchema = z.object(linkOwnerSessionInputShape);

export type LinkOwnerSessionDTO = z.infer<typeof linkOwnerSessionSchema>;

export interface LinkOwnerSessionResultDTO {
  success: boolean;
  message: string;
  owner: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  };
  businesses: Array<{
    id: string;
    name: string;
    trustStatus: string;
  }>;
  sessionId: string | null;
}

