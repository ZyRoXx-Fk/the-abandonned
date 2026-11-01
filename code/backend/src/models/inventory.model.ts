import mongoose, { type Connection, Schema, type InferSchemaType, type Model } from "mongoose";

const inventorySchema = new Schema({
  _id: { type: String, required: true, trim: true },
  businessId: { type: String, required: true, trim: true, index: true },
  sourceInventoryId: { type: String, required: true, trim: true },
  kind: { type: String, required: true, trim: true },
  offeringId: { type: String, trim: true },
  variantId: { type: String, trim: true },
  slotId: { type: String, trim: true },
  slotDate: { type: String, trim: true },
  startTime: { type: String, trim: true },
  endTime: { type: String, trim: true },
  roomTypeId: { type: String, trim: true },
  localNight: { type: String, trim: true },
  revision: { type: Number, required: true, min: 0 },
  published: { type: Boolean, required: true, default: true, index: true },
  remainingUnits: { type: Number, min: 0 },
  totalCapacity: { type: Number, min: 0 },
  allocatedCapacity: { type: Number, min: 0 },
  minPartySize: { type: Number, min: 1 },
  maxPartySize: { type: Number, min: 1 },
  metadata: { type: [Schema.Types.Mixed], required: true, default: [] },
  updatedAt: { type: String, required: true, index: true },
}, {
  versionKey: false,
  collection: "relay_inventory",
});

inventorySchema.index({ businessId: 1, published: 1, kind: 1, updatedAt: -1 });
inventorySchema.index({ businessId: 1, sourceInventoryId: 1 }, { unique: true });

export type InventoryDocument = InferSchemaType<typeof inventorySchema>;

export function getInventoryModel(connection: Connection): Model<InventoryDocument> {
  return (connection.models.RelayInventory as Model<InventoryDocument> | undefined)
    ?? connection.model<InventoryDocument>("RelayInventory", inventorySchema);
}

export const RelayInventory = getInventoryModel(mongoose.connection);
