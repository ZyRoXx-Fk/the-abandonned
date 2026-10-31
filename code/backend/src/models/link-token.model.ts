import { Schema, model, Document, Types } from "mongoose";

export interface ILinkToken extends Document {
  _id: Types.ObjectId;
  token: string;
  ownerId: Types.ObjectId;
  isUsed: boolean;
  expiresAt: Date;
  createdAt: Date;
}

const linkTokenSchema = new Schema<ILinkToken>(
  {
    token: {
      type: String,
      required: [true, "Token is required"],
      unique: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: "Owner",
      required: [true, "Owner ID is required"],
      index: true,
    },
    isUsed: {
      type: Boolean,
      default: false,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: 0 },
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    versionKey: false,
    timestamps: false,
  }
);

export const LinkToken = model<ILinkToken>("LinkToken", linkTokenSchema, "link_tokens");
