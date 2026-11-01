import mongoose, { type Connection, Schema, type InferSchemaType, type Model } from "mongoose";

const businessDraftSchema = new Schema({
  _id: { type: String, required: true, trim: true },
  businessId: { type: String, required: true, trim: true, index: true },
  ownerId: { type: String, required: true, trim: true, index: true },
  category: { type: String, required: true, trim: true },
  revision: { type: Number, required: true, min: 0 },
  publicationFence: { type: Number, default: 0 },
  baseBusinessRevision: { type: Number, default: 0 },
  profile: { type: Schema.Types.Mixed, required: true, default: {} },
  offerings: { type: [Schema.Types.Mixed], required: true, default: [] },
  inventoryEdits: { type: [Schema.Types.Mixed], required: true, default: [] },
  auditTrail: { type: [Schema.Types.Mixed], required: true, default: [] },
  createdAt: { type: String, required: true },
  updatedAt: { type: String, required: true, index: true },
}, {
  versionKey: false,
  minimize: false,
  collection: "relay_business_drafts",
});

businessDraftSchema.index({ ownerId: 1, updatedAt: -1, _id: 1 });

export type BusinessDraftDocument = InferSchemaType<typeof businessDraftSchema>;

export function getBusinessDraftModel(connection: Connection): Model<BusinessDraftDocument> {
  return (connection.models.RelayBusinessDraft as Model<BusinessDraftDocument> | undefined)
    ?? connection.model<BusinessDraftDocument>("RelayBusinessDraft", businessDraftSchema);
}

export const RelayBusinessDraft = getBusinessDraftModel(mongoose.connection);
