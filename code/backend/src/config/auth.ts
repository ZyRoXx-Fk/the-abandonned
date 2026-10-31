import type { FastifyReply, FastifyRequest } from "fastify";

export const SESSION_COOKIE = "relay_session";

export function frontendOrigins(): string[] {
  const configured = process.env.FRONTEND_URL || "http://localhost:4321,http://localhost:4322";
  return configured.split(",").map((origin) => {
    const url = new URL(origin.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("FRONTEND_URL must contain HTTP(S) origins");
    }
    return url.origin;
  });
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/api",
    maxAge: 7 * 24 * 60 * 60,
  };
}

export function isAllowedOrigin(request: FastifyRequest): boolean {
  const origin = request.headers.origin;
  // Non-browser API clients may omit Origin. Browser mutations must use an allowed origin.
  return origin === undefined || frontendOrigins().includes(origin);
}

export async function protectAuthOrigin(request: FastifyRequest, reply: FastifyReply) {
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && !isAllowedOrigin(request)) {
    return reply.status(403).send({ error: "Origin not allowed", code: "ORIGIN_NOT_ALLOWED" });
  }
}
