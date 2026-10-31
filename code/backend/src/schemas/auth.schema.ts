import { z } from "zod";

const nameSchema = z.string().trim().min(1, "Name is required").max(120, "Name is too long");
const emailSchema = z.string().trim().toLowerCase().email("Invalid email address").max(254);
const passwordSchema = z.string()
  .min(8, "Password must be at least 8 characters long")
  .refine((password) => Buffer.byteLength(password, "utf8") <= 72, "Password must not exceed 72 UTF-8 bytes");

export const clientPreferencesSchema = z.object({
  dietaryRestrictions: z.array(z.string()).default([]),
  hasPets: z.boolean().default(false),
  favoriteCuisines: z.array(z.string()).default([]),
});

export type ClientPreferencesDTO = z.infer<typeof clientPreferencesSchema>;

export const registerOwnerSchema = z.object({
  firstName: nameSchema,
  lastName: nameSchema,
  email: emailSchema,
  password: passwordSchema,
});

export type RegisterOwnerDTO = z.infer<typeof registerOwnerSchema>;

export const registerClientSchema = z.object({
  firstName: nameSchema,
  lastName: nameSchema,
  email: emailSchema,
  password: passwordSchema,
  preferences: clientPreferencesSchema.optional(),
});

export type RegisterClientDTO = z.infer<typeof registerClientSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required"),
});

export type LoginDTO = z.infer<typeof loginSchema>;

export const updateClientPreferencesSchema = z.object({
  dietaryRestrictions: z.array(z.string()).optional(),
  hasPets: z.boolean().optional(),
  favoriteCuisines: z.array(z.string()).optional(),
});

export type UpdateClientPreferencesDTO = z.infer<typeof updateClientPreferencesSchema>;
