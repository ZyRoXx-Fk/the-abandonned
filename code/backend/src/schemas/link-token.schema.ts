import { z } from "zod";

export const verifyLinkTokenSchema = z.object({
  token: z
    .string()
    .min(1, "Token is required")
    .trim()
    .toUpperCase(),
});

export type VerifyLinkTokenDTO = z.infer<typeof verifyLinkTokenSchema>;

export interface LinkTokenResponseDTO {
  token: string;
  expiresAt: Date;
  prompt: string;
  owner: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  };
}
