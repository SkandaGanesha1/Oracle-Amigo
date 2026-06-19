import { z } from "zod";

export const emailSchema = z.string().email("Enter a valid email address").max(255);

export const passwordSchema = z.string().min(8, "Password must be at least 8 characters").max(128);

export const displayNameSchema = z.string().min(2, "Display name must be at least 2 characters").max(64).regex(/^[a-zA-Z0-9_ .-]+$/, "Display name can only contain letters, numbers, spaces, and ._-");

export const signupSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: displayNameSchema,
});

export const loginSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
