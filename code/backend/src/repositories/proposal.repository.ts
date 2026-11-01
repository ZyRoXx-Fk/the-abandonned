import type { ClientSession, Connection } from "mongoose";
import { getActionProposalModel } from "../models/action-proposal.model.js";
import { commitResultSchema, proposalRecordSchema, type CommitResult, type ProposalRecord } from "../schemas/action.schema.js";
import { relayIdSchema } from "../schemas/relay.schema.js";
import { createHash } from "node:crypto";

export interface ProposalRepository {
  insert(record: ProposalRecord): Promise<void>;
  get(id: string, tx?: ClientSession): Promise<ProposalRecord | null>;
  getCommittedResult(id: string, tx?: ClientSession): Promise<CommitResult | null>;
  markCommitted(id: string, expectedRevision: number, result: CommitResult, tx: ClientSession): Promise<boolean>;
}

function durableResultRefFor(result: CommitResult): string {
  if (result.kind === "publication") {
    return relayIdSchema.parse(`pub_${createHash("sha256").update(`${result.businessId}|${result.revision}`).digest("hex").slice(0, 24)}`);
  }
  return result.id;
}

export class MongoProposalRepository implements ProposalRepository {
  private readonly proposals;

  constructor(private readonly connection: Connection) {
    this.proposals = getActionProposalModel(connection);
  }

  async insert(record: ProposalRecord): Promise<void> {
    const parsed = proposalRecordSchema.parse(record);
    await this.proposals.create({
      _id: parsed.id,
      principal: parsed.principal,
      revision: parsed.revision,
      kind: parsed.kind,
      payload: parsed.payload,
      summary: parsed.summary,
      termsRevision: parsed.termsRevision,
      expiresAt: parsed.expiresAt,
      state: parsed.state,
      durableResultRef: parsed.durableResultRef,
      durableResult: null,
    });
  }

  async get(id: string, tx?: ClientSession): Promise<ProposalRecord | null> {
    const document = await this.proposals.findById(id).session(tx ?? null).lean();
    if (!document) {
      return null;
    }

    return proposalRecordSchema.parse({
      id: document._id,
      principal: document.principal,
      revision: document.revision,
      kind: document.kind,
      payload: document.payload,
      summary: document.summary,
      termsRevision: document.termsRevision,
      expiresAt: document.expiresAt,
      state: document.state,
      durableResultRef: document.durableResultRef,
    });
  }

  async getCommittedResult(id: string, tx?: ClientSession): Promise<CommitResult | null> {
    const document = await this.proposals.findOne({ _id: id, state: "committed" }).session(tx ?? null).lean();
    return document?.durableResult ? commitResultSchema.parse(document.durableResult) : null;
  }

  async markCommitted(id: string, expectedRevision: number, result: CommitResult, tx: ClientSession): Promise<boolean> {
    const parsed = commitResultSchema.parse(result);
    const updateResult = await this.proposals.updateOne(
      { _id: id, revision: expectedRevision, state: "pending" },
      {
        $set: {
          state: "committed",
          durableResultRef: durableResultRefFor(parsed),
          durableResult: parsed,
        },
        $inc: { revision: 1 },
      },
      { session: tx },
    );

    return updateResult.modifiedCount === 1;
  }
}
