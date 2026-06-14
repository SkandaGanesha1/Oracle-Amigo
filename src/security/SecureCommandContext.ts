import { z } from "zod";

export const SecureCommandContextSchema = z.object({
  sessionId: z.string().min(1).optional(),
  runId: z.string().min(1).optional(),
  userId: z.string().min(1).optional(),
  purpose: z.string().min(1).max(500).optional(),
  networkProfile: z.enum(["none", "npm", "python", "github", "web-basic", "custom"]).optional(),
  workingDirectory: z.string().min(1).max(1000).optional(),
  allowPrivateNetwork: z.boolean().optional().default(false),
  allowRedirection: z.boolean().optional().default(false)
});

export type SecureCommandContext = z.infer<typeof SecureCommandContextSchema>;

export function parseSecureCommandContext(input?: Partial<SecureCommandContext>): SecureCommandContext {
  return SecureCommandContextSchema.parse(input ?? {});
}
