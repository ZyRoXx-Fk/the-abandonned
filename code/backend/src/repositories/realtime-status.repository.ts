import { RealtimeStatus, IRealtimeStatus } from "../models/realtime-status.model.js";

export class RealtimeStatusRepository {
  async findByBusinessId(businessId: string): Promise<IRealtimeStatus | null> {
    return RealtimeStatus.findOne({ businessId });
  }

  async create(data: Partial<IRealtimeStatus>): Promise<IRealtimeStatus> {
    return RealtimeStatus.create(data);
  }

  async updateByBusinessId(
    businessId: string,
    update: Partial<IRealtimeStatus>
  ): Promise<IRealtimeStatus | null> {
    return RealtimeStatus.findOneAndUpdate(
      { businessId },
      { $set: { ...update, lastUpdated: new Date() } },
      { new: true }
    );
  }

  async upsertByBusinessId(
    businessId: string,
    data: Partial<IRealtimeStatus>
  ): Promise<IRealtimeStatus> {
    return RealtimeStatus.findOneAndUpdate(
      { businessId },
      { $set: { ...data, lastUpdated: new Date() } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }
}

export const realtimeStatusRepository = new RealtimeStatusRepository();
