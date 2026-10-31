import { linkTokenRepository, LinkTokenRepository } from "../repositories/link-token.repository.js";
import { ownerRepository, OwnerRepository } from "../repositories/owner.repository.js";
import { TokenManager } from "../utils/managers/token.manager.js";
import { NotFound, Conflict, BadRequest } from "../utils/errors/http.error.js";
import { LinkTokenResponseDTO } from "../schemas/link-token.schema.js";

const LINK_TOKEN_EXPIRATION_MINUTES = 15;

export class LinkTokenService {
  constructor(
    private readonly linkTokenRepo: LinkTokenRepository = linkTokenRepository,
    private readonly ownerRepo: OwnerRepository = ownerRepository
  ) { }

  async generateLinkToken(ownerId: string): Promise<LinkTokenResponseDTO> {
    const owner = await this.ownerRepo.findById(ownerId);
    if (!owner) {
      throw new NotFound("Owner not found");
    }

    await this.linkTokenRepo.invalidatePendingForOwner(ownerId);

    const token = TokenManager.generateLinkToken("TRUST", 6);
    const expiresAt = new Date(Date.now() + LINK_TOKEN_EXPIRATION_MINUTES * 60 * 1000);

    await this.linkTokenRepo.create({
      token,
      ownerId,
      expiresAt,
    });

    const prompt = `Initialisation MCP. Je suis l'entité ${owner.firstName} ${owner.lastName}. Mon token de liaison est : ${token}. Démarrons la configuration de mon restaurant.`;

    return {
      token,
      expiresAt,
      prompt,
      owner: {
        id: owner._id.toString(),
        firstName: owner.firstName,
        lastName: owner.lastName,
        email: owner.email,
      },
    };
  }

  async validateAndConsume(tokenStr: string) {
    const linkToken = await this.linkTokenRepo.findByToken(tokenStr);
    if (!linkToken) {
      throw new NotFound("Invalid link token");
    }

    if (linkToken.isUsed) {
      throw new Conflict("This link token has already been used");
    }

    if (linkToken.expiresAt.getTime() < Date.now()) {
      throw new BadRequest("This link token has expired. Please generate a new one from your dashboard.");
    }

    await this.linkTokenRepo.markAsUsed(linkToken._id.toString());

    const owner = await this.ownerRepo.findById(linkToken.ownerId.toString());
    if (!owner) {
      throw new NotFound("Associated owner account not found");
    }

    return {
      token: linkToken.token,
      owner: {
        id: owner._id.toString(),
        firstName: owner.firstName,
        lastName: owner.lastName,
        email: owner.email,
      },
    };
  }
}

export const linkTokenService = new LinkTokenService();
