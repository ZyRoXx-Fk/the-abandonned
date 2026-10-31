import bcrypt from "bcryptjs";
import { ownerRepository, OwnerRepository } from "../repositories/owner.repository.js";
import { clientRepository, ClientRepository } from "../repositories/client.repository.js";
import {
  RegisterOwnerDTO,
  RegisterClientDTO,
  LoginDTO,
  UpdateClientPreferencesDTO,
} from "../schemas/auth.schema.js";
import { IClientPreferences } from "../models/client.model.js";
import { Conflict, Unauthorized, NotFound, BadRequest } from "../utils/errors/http.error.js";
import { TokenManager } from "../utils/managers/token.manager.js";

export type UserRole = "owner" | "client";

export interface AuthTokenPayload {
  userId: string;
  email: string;
  role: UserRole;
}

export interface AuthResult {
  token: string;
  role: UserRole;
  user: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    createdAt: Date;
    preferences?: IClientPreferences;
  };
}

export class AuthService {
  constructor(
    private readonly ownerRepo: OwnerRepository = ownerRepository,
    private readonly clientRepo: ClientRepository = clientRepository
  ) {}

  async hashPassword(password: string): Promise<string> {
    const salt = await bcrypt.genSalt(10);
    return bcrypt.hash(password, salt);
  }

  async comparePassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  async generateToken(payload: AuthTokenPayload): Promise<string> {
    return TokenManager.generateToken(payload);
  }

  async verifyToken(token: string): Promise<AuthTokenPayload> {
    return TokenManager.verifyToken<AuthTokenPayload>(token);
  }

  async registerOwner(dto: RegisterOwnerDTO): Promise<AuthResult> {
    const existingOwner = await this.ownerRepo.findByEmail(dto.email);
    if (existingOwner) {
      throw new Conflict("An owner with this email already exists");
    }

    const existingClient = await this.clientRepo.findByEmail(dto.email);
    if (existingClient) {
      throw new Conflict("This email is already registered as a client account");
    }

    const passwordHash = await this.hashPassword(dto.password);

    const owner = await this.ownerRepo.create({
      firstName: dto.firstName,
      lastName: dto.lastName,
      email: dto.email,
      passwordHash,
    });

    const token = await this.generateToken({
      userId: owner._id.toString(),
      email: owner.email,
      role: "owner",
    });

    return {
      token,
      role: "owner",
      user: {
        id: owner._id.toString(),
        firstName: owner.firstName,
        lastName: owner.lastName,
        email: owner.email,
        createdAt: owner.createdAt,
      },
    };
  }

  async registerClient(dto: RegisterClientDTO): Promise<AuthResult> {
    const existingClient = await this.clientRepo.findByEmail(dto.email);
    if (existingClient) {
      throw new Conflict("A client with this email already exists");
    }

    const existingOwner = await this.ownerRepo.findByEmail(dto.email);
    if (existingOwner) {
      throw new Conflict("This email is already registered as an owner account");
    }

    const passwordHash = await this.hashPassword(dto.password);

    const client = await this.clientRepo.create({
      firstName: dto.firstName,
      lastName: dto.lastName,
      email: dto.email,
      passwordHash,
      preferences: dto.preferences,
    });

    const token = await this.generateToken({
      userId: client._id.toString(),
      email: client.email,
      role: "client",
    });

    return {
      token,
      role: "client",
      user: {
        id: client._id.toString(),
        firstName: client.firstName,
        lastName: client.lastName,
        email: client.email,
        createdAt: client.createdAt,
        preferences: client.preferences,
      },
    };
  }

  async login(dto: LoginDTO): Promise<AuthResult> {
    // 1. Check in Owner repository
    const owner = await this.ownerRepo.findByEmail(dto.email);
    if (owner) {
      const isValid = await this.comparePassword(dto.password, owner.passwordHash);
      if (!isValid) {
        throw new Unauthorized("Invalid email or password");
      }

      const token = await this.generateToken({
        userId: owner._id.toString(),
        email: owner.email,
        role: "owner",
      });

      return {
        token,
        role: "owner",
        user: {
          id: owner._id.toString(),
          firstName: owner.firstName,
          lastName: owner.lastName,
          email: owner.email,
          createdAt: owner.createdAt,
        },
      };
    }

    // 2. Check in Client repository
    const client = await this.clientRepo.findByEmail(dto.email);
    if (client) {
      const isValid = await this.comparePassword(dto.password, client.passwordHash);
      if (!isValid) {
        throw new Unauthorized("Invalid email or password");
      }

      const token = await this.generateToken({
        userId: client._id.toString(),
        email: client.email,
        role: "client",
      });

      return {
        token,
        role: "client",
        user: {
          id: client._id.toString(),
          firstName: client.firstName,
          lastName: client.lastName,
          email: client.email,
          createdAt: client.createdAt,
          preferences: client.preferences,
        },
      };
    }

    // Neither matched
    throw new Unauthorized("Invalid email or password");
  }

  async getProfile(userId: string, role: UserRole) {
    if (role === "owner") {
      const owner = await this.ownerRepo.findById(userId);
      if (!owner) {
        throw new NotFound("Owner not found");
      }
      return {
        role: "owner",
        id: owner._id.toString(),
        firstName: owner.firstName,
        lastName: owner.lastName,
        email: owner.email,
        createdAt: owner.createdAt,
      };
    }

    if (role === "client") {
      const client = await this.clientRepo.findById(userId);
      if (!client) {
        throw new NotFound("Client not found");
      }
      return {
        role: "client",
        id: client._id.toString(),
        firstName: client.firstName,
        lastName: client.lastName,
        email: client.email,
        preferences: client.preferences,
        createdAt: client.createdAt,
      };
    }

    throw new BadRequest("Unknown user role");
  }

  async updateClientPreferences(clientId: string, dto: UpdateClientPreferencesDTO) {
    const updated = await this.clientRepo.updatePreferences(clientId, dto);
    if (!updated) {
      throw new NotFound("Client not found");
    }

    return {
      id: updated._id.toString(),
      preferences: updated.preferences,
    };
  }
}

export const authService = new AuthService();
