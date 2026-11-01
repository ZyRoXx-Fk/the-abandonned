import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { Owner, type IOwner } from "../../src/models/owner.model.js";
import { Client, type IClient } from "../../src/models/client.model.js";
import { OwnerRepository } from "../../src/repositories/owner.repository.js";
import { ClientRepository } from "../../src/repositories/client.repository.js";
import { AuthService } from "../../src/services/auth.service.js";
import { AuthController } from "../../src/controllers/auth.controller.js";
import { authRoutes } from "../../src/routes/auth.routes.js";
import { frontendOrigins } from "../../src/config/auth.js";

// Only persistence is replaced. Tests exercise real schemas, bcrypt, JWT, cookies and routes.
export class MemoryOwnerRepository extends OwnerRepository {
  records = new Map<string, IOwner>();
  async findByEmail(email: string) { return this.records.get(email.toLowerCase().trim()) || null; }
  async findById(id: string) { return [...this.records.values()].find((record) => record._id.toString() === id) || null; }
  async create(data: Parameters<OwnerRepository["create"]>[0]) {
    const owner = new Owner(data);
    this.records.set(owner.email, owner);
    return owner;
  }
}

export class MemoryClientRepository extends ClientRepository {
  records = new Map<string, IClient>();
  async findByEmail(email: string) { return this.records.get(email.toLowerCase().trim()) || null; }
  async findById(id: string) { return [...this.records.values()].find((record) => record._id.toString() === id) || null; }
  async create(data: Parameters<ClientRepository["create"]>[0]) {
    const client = new Client(data);
    this.records.set(client.email, client);
    return client;
  }
  async updatePreferences(id: string, preferences: Parameters<ClientRepository["updatePreferences"]>[1]) {
    const client = await this.findById(id);
    if (!client) return null;
    Object.assign(client.preferences, preferences);
    return client;
  }
}

export async function buildAuthTestApp() {
  const owners = new MemoryOwnerRepository();
  const clients = new MemoryClientRepository();
  const service = new AuthService(owners, clients);
  const app = Fastify({ logger: false });
  await app.register(cors, { origin: frontendOrigins(), credentials: true });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  await app.register(authRoutes, { prefix: "/api/auth", controller: new AuthController(service) });
  await app.ready();
  return { app, service, owners, clients };
}
