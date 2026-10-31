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
  UpdateBusinessStatusDTO,
  UpdateBusinessStatusResultDTO,
  SearchRestaurantsDTO,
  SearchRestaurantsResultDTO,
  SearchRestaurantItemDTO,
} from "../schemas/business.schema.js";
import { NotFound, Forbidden, BadRequest } from "../utils/errors/http.error.js";
import { IBusiness } from "../models/business.model.js";
import { IRealtimeStatus } from "../models/realtime-status.model.js";

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

  async updateBusinessStatus(
    ownerId: string,
    dto: UpdateBusinessStatusDTO
  ): Promise<UpdateBusinessStatusResultDTO> {
    const owner = await this.ownerRepo.findById(ownerId);
    if (!owner) {
      throw new NotFound("Owner account not found. Please log in or register.");
    }

    let business: IBusiness | null = null;

    if (dto.businessId) {
      const found = await this.businessRepo.findById(dto.businessId);
      if (!found) {
        throw new NotFound(`Restaurant with ID '${dto.businessId}' not found.`);
      }
      if (found.ownerId.toString() !== ownerId) {
        throw new Forbidden("You do not have permission to modify this restaurant.");
      }
      business = found;
    } else if (dto.businessName) {
      business = await this.businessRepo.findByNameAndOwnerId(dto.businessName, ownerId);
      if (!business) {
        throw new NotFound(
          `No restaurant named '${dto.businessName}' found under your owner account.`
        );
      }
    } else {
      const ownerBusinesses = await this.businessRepo.findAllByOwnerId(ownerId);
      if (ownerBusinesses.length === 0) {
        throw new NotFound(
          "No registered restaurant found for your owner account. Please register one first with 'save_business_profile'."
        );
      }
      if (ownerBusinesses.length > 1) {
        throw new BadRequest(
          `You have ${ownerBusinesses.length} registered restaurants. Please specify which restaurant to update using 'businessName' or 'businessId'.`
        );
      }
      business = ownerBusinesses[0];
    }

    const updatePayload: Partial<IRealtimeStatus> = {};
    const changeLog: string[] = [];

    if (dto.isTerraceOpen !== undefined) {
      updatePayload.isTerraceOpen = dto.isTerraceOpen;
      changeLog.push(`Terrace: ${dto.isTerraceOpen ? "OPEN" : "CLOSED"}`);
    }
    if (dto.availableSeats !== undefined) {
      updatePayload.availableSeats = dto.availableSeats;
      changeLog.push(`Available seats: ${dto.availableSeats}`);
    }
    if (dto.activeAlert !== undefined) {
      updatePayload.activeAlert = dto.activeAlert.trim();
      changeLog.push(
        dto.activeAlert.trim() ? `Active alert: "${dto.activeAlert.trim()}"` : "Alert cleared"
      );
    }

    if (changeLog.length === 0) {
      throw new BadRequest(
        "No status update provided. Please specify isTerraceOpen, availableSeats, or activeAlert."
      );
    }

    const updatedRealtime = await this.realtimeRepo.upsertByBusinessId(
      business._id.toString(),
      updatePayload
    );

    return {
      success: true,
      business: {
        id: business._id.toString(),
        name: business.name,
        trustStatus: business.trustStatus,
      },
      realtimeStatus: {
        isTerraceOpen: updatedRealtime.isTerraceOpen,
        availableSeats: updatedRealtime.availableSeats,
        activeAlert: updatedRealtime.activeAlert || "",
        lastUpdated: updatedRealtime.lastUpdated.toISOString(),
      },
      message: `Live status for '${business.name}' successfully updated: ${changeLog.join(" | ")}. Timestamp: ${updatedRealtime.lastUpdated.toISOString()}.`,
    };
  }

  async searchRestaurants(
    query: SearchRestaurantsDTO
  ): Promise<SearchRestaurantsResultDTO> {
    const businesses = await this.businessRepo.findTrustedBusinesses({
      cuisine: query.cuisine,
      amenities: query.amenities,
    });

    if (businesses.length === 0) {
      return {
        count: 0,
        restaurants: [],
        summary: "No certified restaurants found matching your criteria in Basel.",
      };
    }

    const businessIds = businesses.map((b) => b._id.toString());
    const realtimes = await this.realtimeRepo.findByBusinessIds(businessIds);
    const realtimeMap = new Map(realtimes.map((r) => [r.businessId.toString(), r]));

    const now = Date.now();
    const results: SearchRestaurantItemDTO[] = [];

    for (const b of businesses) {
      const bid = b._id.toString();
      const rt = realtimeMap.get(bid);

      const isTerraceOpen = rt?.isTerraceOpen ?? (b.mcpProfile.amenities || []).includes("terrace");
      const availableSeats = rt?.availableSeats ?? b.mcpProfile.baseCapacity;
      const activeAlert = rt?.activeAlert || "";
      const lastUpdatedDate = rt?.lastUpdated || b.updatedAt || new Date();
      const freshnessMinutes = Math.max(
        0,
        Math.round((now - new Date(lastUpdatedDate).getTime()) / (60 * 1000))
      );

      // Filter by open terrace if requested
      if (query.onlyOpenTerrace && !isTerraceOpen) {
        continue;
      }

      // Filter by min seats if requested
      if (query.minSeats !== undefined && availableSeats < query.minSeats) {
        continue;
      }

      results.push({
        id: bid,
        name: b.name,
        trustStatus: b.trustStatus,
        cuisine: b.mcpProfile.cuisine,
        address: b.mcpProfile.address,
        baseCapacity: b.mcpProfile.baseCapacity,
        amenities: b.mcpProfile.amenities,
        realtime: {
          isTerraceOpen,
          availableSeats,
          activeAlert,
          lastUpdated: new Date(lastUpdatedDate).toISOString(),
          freshnessMinutes,
        },
      });

      if (query.limit && results.length >= query.limit) {
        break;
      }
    }

    const summary =
      results.length > 0
        ? `Found ${results.length} certified restaurant(s) in Basel matching your request with live verified status.`
        : "No certified restaurants currently open or matching all real-time constraints.";

    return {
      count: results.length,
      restaurants: results,
      summary,
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
