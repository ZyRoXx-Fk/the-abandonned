import mongoose, { type Connection, Schema, type InferSchemaType, type Model } from "mongoose";

const reservationSchema = new Schema({
  _id: { type: String, required: true, trim: true },
  reference: { type: String, required: true, trim: true },
  ownerId: { type: String, required: true, trim: true, index: true },
  clientId: { type: String, required: true, trim: true, index: true },
  businessId: { type: String, required: true, trim: true, index: true },
  proposalId: { type: String, required: true, trim: true, unique: true },
  revision: { type: Number, required: true, min: 0 },
  kind: { type: String, required: true, trim: true },
  result: { type: Schema.Types.Mixed, required: true },
  allocations: { type: [Schema.Types.Mixed], required: true, default: [] },
  createdAt: { type: String, required: true, index: true },
  updatedAt: { type: String, required: true, index: true },
}, {
  versionKey: false,
  collection: "relay_reservations",
});

reservationSchema.index({ ownerId: 1, businessId: 1, createdAt: -1, _id: -1 });

export type ReservationDocument = InferSchemaType<typeof reservationSchema>;

export function getReservationModel(connection: Connection): Model<ReservationDocument> {
  return (connection.models.RelayReservation as Model<ReservationDocument> | undefined)
    ?? connection.model<ReservationDocument>("RelayReservation", reservationSchema);
}

export const RelayReservation = getReservationModel(mongoose.connection);
