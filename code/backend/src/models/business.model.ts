import mongoose, { Schema, type Connection, type Document, type Model, Types } from "mongoose";
import type { BusinessProfile } from "../schemas/catalog.schema.js";
import type { BusinessCategory } from "../schemas/relay.schema.js";

export type TrustStatus = "trusted" | "pending" | "unverified";

export interface IAuditReport {
  isWebsiteLegacy: boolean;
  missingData: string[];
  seoScore: number;
  recommendations?: string[];
}

export interface IMcpProfile {
  category: string;
  cuisine: string;
  address: string;
  baseCapacity: number;
  amenities: string[];
}

export interface IBusiness extends Document {
  _id: Types.ObjectId;
  ownerId: Types.ObjectId;
  name: string;
  trustStatus: TrustStatus;
  auditReport?: IAuditReport;
  mcpProfile: IMcpProfile;
  relayBusinessId?: string;
  relayOwnerId?: string;
  relayCategory?: BusinessCategory;
  relayRevision?: number;
  relayProfile?: BusinessProfile;
  relayPublishedAt?: string;
  relayUpdatedAt?: string;
  createdAt: Date;
  updatedAt: Date;
}

const auditReportSchema = new Schema<IAuditReport>(
  {
    isWebsiteLegacy: { type: Boolean, default: false },
    missingData: { type: [String], default: [] },
    seoScore: { type: Number, min: 0, max: 100, default: 0 },
    recommendations: { type: [String], default: [] },
  },
  { _id: false },
);

const mcpProfileSchema = new Schema<IMcpProfile>(
  {
    category: { type: String, default: "restaurant", trim: true },
    cuisine: { type: String, default: "relay", trim: true },
    address: { type: String, default: "relay", trim: true },
    baseCapacity: { type: Number, default: 1, min: 1 },
    amenities: { type: [String], default: [] },
  },
  { _id: false },
);

const businessSchema = new Schema<IBusiness>(
  {
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: "Owner",
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    trustStatus: {
      type: String,
      enum: ["trusted", "pending", "unverified"],
      default: "pending",
      index: true,
    },
    auditReport: {
      type: auditReportSchema,
      default: undefined,
    },
    mcpProfile: {
      type: mcpProfileSchema,
      required: true,
    },
    relayBusinessId: {
      type: String,
      trim: true,
      sparse: true,
      unique: true,
    },
    relayOwnerId: {
      type: String,
      trim: true,
      index: true,
    },
    relayCategory: {
      type: String,
      trim: true,
      index: true,
    },
    relayRevision: {
      type: Number,
      min: 0,
      index: true,
    },
    relayProfile: {
      type: Schema.Types.Mixed,
      default: undefined,
    },
    relayPublishedAt: {
      type: String,
      index: true,
    },
    relayUpdatedAt: {
      type: String,
      index: true,
    },
  },
  {
    versionKey: false,
    timestamps: true,
  },
);

businessSchema.index({ "mcpProfile.cuisine": 1, trustStatus: 1 });
businessSchema.index({ relayOwnerId: 1, relayUpdatedAt: -1, relayBusinessId: 1 });
businessSchema.index({ relayCategory: 1, relayUpdatedAt: -1, relayBusinessId: 1 });

export function getBusinessModel(connection: Connection): Model<IBusiness> {
  return (connection.models.Business as Model<IBusiness> | undefined)
    ?? connection.model<IBusiness>("Business", businessSchema);
}

export const Business = getBusinessModel(mongoose.connection);
