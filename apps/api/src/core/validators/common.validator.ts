import { z } from "zod";

/**
 * Common Field Validators
 */

export const agentIdValidator = z
  .string()
  .trim()
  .min(1, "Agent ID is required.");

export const nameValidator = z
  .string()
  .trim()
  .min(2, "Name is required.")
  .max(100, "Name is too long.");

export const emailValidator = z
  .string()
  .trim()
  .min(1, "Email is required.")
  .email("Invalid email address.");

export const phoneValidator = z
  .string()
  .trim()
  .min(10, "Phone number must be at least 10 digits.")
  .max(15, "Phone number is too long.");

export const passwordValidator = z
  .string()
  .min(8, "Password must be at least 8 characters.")
  .max(100, "Password is too long.");

export const otpValidator = z
  .string()
  .trim()
  .length(6, "OTP must be 6 digits.");

export const addressValidator = z
  .string()
  .trim()
  .min(1, "Address is required.");

export const accountTypeValidator = z.enum(["BC", "CSP"], {
  message: "Account type must be BC or CSP.",
});
