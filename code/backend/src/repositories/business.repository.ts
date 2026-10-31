import { Business, IBusiness } from "../models/business.model.js";

export class BusinessRepository {
  async findById(id: string): Promise<IBusiness | null> {
    return Business.findById(id);
  }

  async findByOwnerId(ownerId: string): Promise<IBusiness | null> {
    return Business.findOne({ ownerId });
  }

  async findAllByOwnerId(ownerId: string): Promise<IBusiness[]> {
    return Business.find({ ownerId });
  }

  async create(data: Partial<IBusiness>): Promise<IBusiness> {
    return Business.create(data);
  }

  async updateById(id: string, update: Partial<IBusiness>): Promise<IBusiness | null> {
    return Business.findByIdAndUpdate(id, { $set: update }, { new: true });
  }
}

export const businessRepository = new BusinessRepository();
