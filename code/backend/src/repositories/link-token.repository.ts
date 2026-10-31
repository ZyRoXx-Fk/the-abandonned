import { LinkToken, ILinkToken } from "../models/link-token.model.js";

export class LinkTokenRepository {
  async create(data: {
    token: string;
    ownerId: string;
    expiresAt: Date;
  }): Promise<ILinkToken> {
    return LinkToken.create({
      token: data.token.toUpperCase().trim(),
      ownerId: data.ownerId,
      expiresAt: data.expiresAt,
      isUsed: false,
    });
  }

  async findByToken(token: string): Promise<ILinkToken | null> {
    return LinkToken.findOne({
      token: token.toUpperCase().trim(),
    });
  }

  async markAsUsed(id: string): Promise<ILinkToken | null> {
    return LinkToken.findByIdAndUpdate(
      id,
      { isUsed: true },
      { new: true }
    );
  }

  async invalidatePendingForOwner(ownerId: string): Promise<void> {
    await LinkToken.deleteMany({
      ownerId,
      isUsed: false,
    });
  }
}

export const linkTokenRepository = new LinkTokenRepository();
