import { z } from "zod";

export const NetworkProfileSchema = z.enum(["none", "npm", "python", "github", "web-basic", "custom"]);

export const CreateSandboxSessionSchema = z.object({
  purpose: z.string().min(1).max(500),
  networkProfile: NetworkProfileSchema,
  allowedHosts: z.array(z.string().min(1)).optional(),
  ttlSeconds: z.number().int().positive().max(86400).optional()
});

export const RunShellCommandSchema = z.object({
  sessionId: z.string().min(1),
  command: z.string().min(1),
  timeoutMs: z.number().int().positive().optional(),
  workingDirectory: z.string().min(1).optional()
});

export const RunCodeSchema = z.object({
  sessionId: z.string().min(1),
  code: z.string().min(1),
  timeoutMs: z.number().int().positive().optional()
});

export const CloneRepoAndRunTestsSchema = z.object({
  sessionId: z.string().min(1),
  repoUrl: z.string().url().refine((value) => /^https:\/\/github\.com\/[^/]+\/[^/]+(?:\.git)?$/i.test(value), {
    message: "Only https://github.com owner/repo URLs are allowed"
  }),
  testCommand: z.string().min(1),
  timeoutMs: z.number().int().positive().optional()
});

export const CloseSandboxSessionSchema = z.object({
  sessionId: z.string().min(1)
});

export type CreateSandboxSessionRequest = z.infer<typeof CreateSandboxSessionSchema>;
export type RunShellCommandRequest = z.infer<typeof RunShellCommandSchema>;
export type RunCodeRequest = z.infer<typeof RunCodeSchema>;
export type CloneRepoAndRunTestsRequest = z.infer<typeof CloneRepoAndRunTestsSchema>;
export type CloseSandboxSessionRequest = z.infer<typeof CloseSandboxSessionSchema>;
