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
