import { Owner, IOwner } from "../models/owner.model.js";

export class OwnerRepository {
  async findByEmail(email: string): Promise<IOwner | null> {
    return Owner.findOne({ email: email.toLowerCase().trim() });
  }

  async findById(id: string): Promise<IOwner | null> {
    return Owner.findById(id);
  }

  async create(data: {
    firstName: string;
    lastName: string;
    email: string;
    passwordHash: string;
  }): Promise<IOwner> {
    return Owner.create({
      firstName: data.firstName.trim(),
      lastName: data.lastName.trim(),
      email: data.email.toLowerCase().trim(),
      passwordHash: data.passwordHash,
    });
  }
}

export const ownerRepository = new OwnerRepository();
