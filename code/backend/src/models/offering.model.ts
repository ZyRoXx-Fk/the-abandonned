import mongoose, { type Connection, Schema, type InferSchemaType, type Model } from "mongoose";

const offeringSchema = new Schema({
  businessId: { type: String, required: true, trim: true, index: true },
  offeringId: { type: String, required: true, trim: true },
  category: { type: String, required: true, trim: true },
  revision: { type: Number, required: true, min: 0 },
  published: { type: Boolean, required: true, default: true, index: true },
  payload: { type: Schema.Types.Mixed, required: true },
  updatedAt: { type: String, required: true, index: true },
}, {
  versionKey: false,
  collection: "relay_offerings",
});

offeringSchema.index({ businessId: 1, offeringId: 1 }, { unique: true });
offeringSchema.index({ businessId: 1, published: 1, updatedAt: -1 });

export type OfferingDocument = InferSchemaType<typeof offeringSchema>;

export function getOfferingModel(connection: Connection): Model<OfferingDocument> {
  return (connection.models.RelayOffering as Model<OfferingDocument> | undefined)
    ?? connection.model<OfferingDocument>("RelayOffering", offeringSchema);
}

export const RelayOffering = getOfferingModel(mongoose.connection);
