import { Schema, model, Document, Types } from "mongoose";

export interface IRealtimeStatus extends Document {
  _id: Types.ObjectId;
  businessId: Types.ObjectId;
  isTerraceOpen: boolean;
  availableSeats: number;
  activeAlert?: string;
  lastUpdated: Date;
}

const realtimeStatusSchema = new Schema<IRealtimeStatus>(
  {
    businessId: {
      type: Schema.Types.ObjectId,
      ref: "Business",
      required: [true, "Business ID is required"],
      unique: true,
      index: true,
    },
    isTerraceOpen: {
      type: Boolean,
      default: false,
    },
    availableSeats: {
      type: Number,
      default: 0,
      min: 0,
    },
    activeAlert: {
      type: String,
      default: "",
      trim: true,
    },
    lastUpdated: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    versionKey: false,
    timestamps: false,
  }
);

export const RealtimeStatus = model<IRealtimeStatus>(
  "RealtimeStatus",
  realtimeStatusSchema,
  "realtime_status"
);
