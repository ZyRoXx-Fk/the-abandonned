import { Schema, model, Document, Types } from "mongoose";

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
  { _id: false }
);

const mcpProfileSchema = new Schema<IMcpProfile>(
  {
    category: { type: String, default: "restaurant", trim: true },
    cuisine: { type: String, required: true, trim: true },
    address: { type: String, required: true, trim: true },
    baseCapacity: { type: Number, required: true, min: 1 },
    amenities: { type: [String], default: [] },
  },
  { _id: false }
);

const businessSchema = new Schema<IBusiness>(
  {
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: "Owner",
      required: [true, "Owner ID is required"],
      index: true,
    },
    name: {
      type: String,
      required: [true, "Business name is required"],
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
  },
  {
    versionKey: false,
    timestamps: true,
  }
);

// Compound index for queries filtering by cuisine and trustStatus
businessSchema.index({ "mcpProfile.cuisine": 1, trustStatus: 1 });

export const Business = model<IBusiness>("Business", businessSchema);
