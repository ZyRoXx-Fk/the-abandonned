import { Types } from "mongoose";
import { businessRepository, BusinessRepository } from "../repositories/business.repository.js";
import {
  realtimeStatusRepository,
  RealtimeStatusRepository,
} from "../repositories/realtime-status.repository.js";
import { ownerRepository, OwnerRepository } from "../repositories/owner.repository.js";
import {
  SaveBusinessProfileDTO,
  SaveBusinessProfileResultDTO,
} from "../schemas/business.schema.js";
import { NotFound, Forbidden } from "../utils/errors/http.error.js";
import { IBusiness } from "../models/business.model.js";

export class BusinessService {
  constructor(
    private readonly businessRepo: BusinessRepository = businessRepository,
    private readonly realtimeRepo: RealtimeStatusRepository = realtimeStatusRepository,
    private readonly ownerRepo: OwnerRepository = ownerRepository
  ) {}

  async saveBusinessProfile(
    ownerId: string,
    dto: SaveBusinessProfileDTO
  ): Promise<SaveBusinessProfileResultDTO> {
    const owner = await this.ownerRepo.findById(ownerId);
    if (!owner) {
      throw new NotFound("Owner account not found. Please log in or register.");
    }

    let business: IBusiness;

    if (dto.businessId) {
      const existing = await this.businessRepo.findById(dto.businessId);
      if (!existing) {
        throw new NotFound(`Business with ID '${dto.businessId}' not found.`);
      }
      if (existing.ownerId.toString() !== ownerId) {
        throw new Forbidden("You do not have permission to modify this business.");
      }

      const updated = await this.businessRepo.updateById(dto.businessId, {
        name: dto.name.trim(),
        trustStatus: "trusted",
        mcpProfile: {
          category: dto.category || "restaurant",
          cuisine: dto.cuisine.trim(),
          address: dto.address.trim(),
          baseCapacity: dto.baseCapacity,
          amenities: dto.amenities || [],
        },
      });

      if (!updated) {
        throw new NotFound("Failed to update business profile.");
      }
      business = updated;
    } else {
      business = await this.businessRepo.create({
        ownerId: new Types.ObjectId(ownerId),
        name: dto.name.trim(),
        trustStatus: "trusted",
        mcpProfile: {
          category: dto.category || "restaurant",
          cuisine: dto.cuisine.trim(),
          address: dto.address.trim(),
          baseCapacity: dto.baseCapacity,
          amenities: dto.amenities || [],
        },
      });
    }

    const hasTerrace = (dto.amenities || []).includes("terrace");
    const initialTerraceOpen =
      dto.isTerraceOpen !== undefined ? dto.isTerraceOpen : hasTerrace;
    const initialAvailableSeats =
      dto.availableSeats !== undefined ? dto.availableSeats : dto.baseCapacity;

    const realtime = await this.realtimeRepo.upsertByBusinessId(business._id.toString(), {
      isTerraceOpen: initialTerraceOpen,
      availableSeats: initialAvailableSeats,
      activeAlert: "",
    });

    return {
      success: true,
      business: {
        id: business._id.toString(),
        ownerId: business.ownerId.toString(),
        name: business.name,
        trustStatus: business.trustStatus,
        mcpProfile: {
          category: business.mcpProfile.category,
          cuisine: business.mcpProfile.cuisine,
          address: business.mcpProfile.address,
          baseCapacity: business.mcpProfile.baseCapacity,
          amenities: business.mcpProfile.amenities,
        },
        realtimeStatus: {
          isTerraceOpen: realtime.isTerraceOpen,
          availableSeats: realtime.availableSeats,
          activeAlert: realtime.activeAlert || "",
          lastUpdated: realtime.lastUpdated.toISOString(),
        },
      },
      message: `Restaurant '${business.name}' certified and registered with 'trusted' status. Real-time availability stream initialized (${realtime.availableSeats} seats, terrace: ${realtime.isTerraceOpen ? "open" : "closed"}).`,
    };
  }

  async getBusinessById(businessId: string) {
    return this.businessRepo.findById(businessId);
  }

  async getBusinessesByOwnerId(ownerId: string) {
    return this.businessRepo.findAllByOwnerId(ownerId);
  }
}

export const businessService = new BusinessService();
