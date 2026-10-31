import { Schema, model, Document, Types } from "mongoose";

export interface IOwner extends Document {
  _id: Types.ObjectId;
  firstName: string;
  lastName: string;
  email: string;
  passwordHash: string;
  createdAt: Date;
}

const ownerSchema = new Schema<IOwner>(
  {
    firstName: {
      type: String,
      required: [true, "First name is required"],
      trim: true,
    },
    lastName: {
      type: String,
      required: [true, "Last name is required"],
      trim: true,
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/\S+@\S+\.\S+/, "Email format is invalid"],
    },
    passwordHash: {
      type: String,
      required: [true, "Password hash is required"],
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

export const Owner = model<IOwner>("Owner", ownerSchema);
