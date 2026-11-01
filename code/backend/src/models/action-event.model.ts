import mongoose, { type Connection, Schema, type InferSchemaType, type Model } from "mongoose";

const actionEventSchema = new Schema({
  principal: {
    role: { type: String, required: true, trim: true },
    userId: { type: String, required: true, trim: true },
  },
  proposalId: { type: String, required: true, trim: true, unique: true },
  proposalKind: { type: String, required: true, trim: true },
  businessId: { type: String, required: true, trim: true, index: true },
  resultRef: { type: String, default: null, trim: true },
  result: { type: Schema.Types.Mixed, required: true },
  payload: { type: Schema.Types.Mixed, required: true },
  summary: { type: Schema.Types.Mixed, required: true },
  createdAt: { type: String, required: true, index: true },
}, {
  versionKey: false,
  collection: "relay_action_events",
});

actionEventSchema.index({ businessId: 1, createdAt: -1 });

export type ActionEventDocument = InferSchemaType<typeof actionEventSchema>;

export function getActionEventModel(connection: Connection): Model<ActionEventDocument> {
  return (connection.models.RelayActionEvent as Model<ActionEventDocument> | undefined)
    ?? connection.model<ActionEventDocument>("RelayActionEvent", actionEventSchema);
}

export const RelayActionEvent = getActionEventModel(mongoose.connection);
