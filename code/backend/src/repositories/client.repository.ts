import { Client, IClient, IClientPreferences } from "../models/client.model.js";

export class ClientRepository {
  async findByEmail(email: string): Promise<IClient | null> {
    return Client.findOne({ email: email.toLowerCase().trim() });
  }

  async findById(id: string): Promise<IClient | null> {
    return Client.findById(id);
  }

  async create(data: {
    firstName: string;
    lastName: string;
    email: string;
    passwordHash: string;
    preferences?: Partial<IClientPreferences>;
  }): Promise<IClient> {
    return Client.create({
      firstName: data.firstName.trim(),
      lastName: data.lastName.trim(),
      email: data.email.toLowerCase().trim(),
      passwordHash: data.passwordHash,
      preferences: {
        dietaryRestrictions: data.preferences?.dietaryRestrictions || [],
        hasPets: Boolean(data.preferences?.hasPets),
        favoriteCuisines: data.preferences?.favoriteCuisines || [],
      },
    });
  }

  async updatePreferences(
    id: string,
    preferences: Partial<IClientPreferences>
  ): Promise<IClient | null> {
    const client = await Client.findById(id);
    if (!client) return null;

    if (preferences.dietaryRestrictions !== undefined) {
      client.preferences.dietaryRestrictions = preferences.dietaryRestrictions;
    }
    if (preferences.hasPets !== undefined) {
      client.preferences.hasPets = Boolean(preferences.hasPets);
    }
    if (preferences.favoriteCuisines !== undefined) {
      client.preferences.favoriteCuisines = preferences.favoriteCuisines;
    }

    await client.save();
    return client;
  }
}

export const clientRepository = new ClientRepository();
