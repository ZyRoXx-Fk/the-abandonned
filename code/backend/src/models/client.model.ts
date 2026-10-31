import { Schema, model, Document, Types } from "mongoose";

export interface IClientPreferences {
  dietaryRestrictions: string[];
  hasPets: boolean;
  favoriteCuisines: string[];
}

export interface IClient extends Document {
  _id: Types.ObjectId;
  firstName: string;
  lastName: string;
  email: string;
  passwordHash: string;
  preferences: IClientPreferences;
  createdAt: Date;
}

const clientPreferencesSchema = new Schema<IClientPreferences>(
  {
    dietaryRestrictions: {
      type: [String],
      default: [],
    },
    hasPets: {
      type: Boolean,
      default: false,
    },
    favoriteCuisines: {
      type: [String],
      default: [],
    },
  },
  { _id: false }
);

const clientSchema = new Schema<IClient>(
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
    preferences: {
      type: clientPreferencesSchema,
      default: () => ({
        dietaryRestrictions: [],
        hasPets: false,
        favoriteCuisines: [],
      }),
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

export const Client = model<IClient>("Client", clientSchema, "clients");
