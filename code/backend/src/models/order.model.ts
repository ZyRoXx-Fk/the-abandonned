import mongoose, { type Connection, Schema, type InferSchemaType, type Model } from "mongoose";

const orderSchema = new Schema({
  _id: { type: String, required: true, trim: true },
  reference: { type: String, required: true, trim: true },
  ownerId: { type: String, required: true, trim: true, index: true },
  clientId: { type: String, required: true, trim: true, index: true },
  businessId: { type: String, required: true, trim: true, index: true },
  proposalId: { type: String, required: true, trim: true, unique: true },
  revision: { type: Number, required: true, min: 0 },
  result: { type: Schema.Types.Mixed, required: true },
  allocations: { type: [Schema.Types.Mixed], required: true, default: [] },
  createdAt: { type: String, required: true, index: true },
  updatedAt: { type: String, required: true, index: true },
}, {
  versionKey: false,
  collection: "relay_orders",
});

orderSchema.index({ ownerId: 1, businessId: 1, createdAt: -1, _id: -1 });

export type OrderDocument = InferSchemaType<typeof orderSchema>;

export function getOrderModel(connection: Connection): Model<OrderDocument> {
  return (connection.models.RelayOrder as Model<OrderDocument> | undefined)
    ?? connection.model<OrderDocument>("RelayOrder", orderSchema);
}

export const RelayOrder = getOrderModel(mongoose.connection);
