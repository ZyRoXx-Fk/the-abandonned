import { FastifyRequest, FastifyReply } from "fastify";
import { AuthTokenPayload } from "../services/auth.service.js";
import { Unauthorized } from "../utils/errors/http.error.js";
import { TokenManager } from "../utils/managers/token.manager.js";

export async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const authHeader = request.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    const error = new Unauthorized("Missing or invalid Authorization header");
    return reply.status(error.statusCode).send({
      error: error.message,
    });
  }

  const token = authHeader.substring(7);

  try {
    const payload: AuthTokenPayload = await TokenManager.verifyToken<AuthTokenPayload>(token);
    (request as any).user = payload;
  } catch (err) {
    const error = new Unauthorized("Invalid or expired token");
    return reply.status(error.statusCode).send({
      error: error.message,
    });
  }
}
