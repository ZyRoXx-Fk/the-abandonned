import mongoose, { type Connection, Schema, type InferSchemaType, type Model } from "mongoose";

const actionProposalSchema = new Schema({
  _id: { type: String, required: true, trim: true },
  principal: {
    role: { type: String, required: true, trim: true },
    userId: { type: String, required: true, trim: true },
  },
  revision: { type: Number, required: true, min: 0 },
  kind: { type: String, required: true, trim: true },
  payload: { type: Schema.Types.Mixed, required: true },
  summary: { type: Schema.Types.Mixed, required: true },
  termsRevision: { type: Schema.Types.Mixed, required: true },
  expiresAt: { type: String, required: true, index: true },
  state: { type: String, required: true, trim: true, index: true },
  durableResultRef: { type: String, default: null },
  durableResult: { type: Schema.Types.Mixed, default: null },
}, {
  versionKey: false,
  collection: "relay_action_proposals",
});

actionProposalSchema.index({ "principal.userId": 1, state: 1, expiresAt: 1 });

export type ActionProposalDocument = InferSchemaType<typeof actionProposalSchema>;

export function getActionProposalModel(connection: Connection): Model<ActionProposalDocument> {
  return (connection.models.RelayActionProposal as Model<ActionProposalDocument> | undefined)
    ?? connection.model<ActionProposalDocument>("RelayActionProposal", actionProposalSchema);
}

export const RelayActionProposal = getActionProposalModel(mongoose.connection);
