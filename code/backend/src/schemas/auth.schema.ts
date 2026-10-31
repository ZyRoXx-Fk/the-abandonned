import { z } from "zod";

export const clientPreferencesSchema = z.object({
  dietaryRestrictions: z.array(z.string()).default([]),
  hasPets: z.boolean().default(false),
  favoriteCuisines: z.array(z.string()).default([]),
});

export type ClientPreferencesDTO = z.infer<typeof clientPreferencesSchema>;

export const registerOwnerSchema = z.object({
  firstName: z.string().min(1, "First name is required").trim(),
  lastName: z.string().min(1, "Last name is required").trim(),
  email: z.string().email("Invalid email address").toLowerCase().trim(),
  password: z.string().min(6, "Password must be at least 6 characters long"),
});

export type RegisterOwnerDTO = z.infer<typeof registerOwnerSchema>;

export const registerClientSchema = z.object({
  firstName: z.string().min(1, "First name is required").trim(),
  lastName: z.string().min(1, "Last name is required").trim(),
  email: z.string().email("Invalid email address").toLowerCase().trim(),
  password: z.string().min(6, "Password must be at least 6 characters long"),
  preferences: clientPreferencesSchema.optional(),
});

export type RegisterClientDTO = z.infer<typeof registerClientSchema>;

export const loginSchema = z.object({
  email: z.string().email("Invalid email address").toLowerCase().trim(),
  password: z.string().min(1, "Password is required"),
});

export type LoginDTO = z.infer<typeof loginSchema>;

export const updateClientPreferencesSchema = z.object({
  dietaryRestrictions: z.array(z.string()).optional(),
  hasPets: z.boolean().optional(),
  favoriteCuisines: z.array(z.string()).optional(),
});

export type UpdateClientPreferencesDTO = z.infer<typeof updateClientPreferencesSchema>;
