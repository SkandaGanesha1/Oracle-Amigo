# Implementation Plan

[Overview]
Create a comprehensive security remediation for the Oracle Amigo backend codebase addressing OWASP Top 10 issues (primarily injection via command policy bypasses, broken authentication in control-plane, SSRF vectors, insecure crypto), race conditions in sandbox execution, weak secret redaction, and missing validation.

The existing CommandPolicy relies on brittle regex patterns in normalizeCommand() and evaluate() that are easily bypassed via encoding, command chaining, and alternative syntax (as identified in the white-box audit of src/policy/CommandPolicy.ts, src/policy/SecretPolicy.ts, src/security/anp/AnpCrypto.ts, src/sandbox/GondolinSandbox.ts, apps/control-plane/src/auth/TokenService.ts and related files). This plan introduces a layered defense with AST-based parsing for PowerShell/Shell, strict allow-list execution, cryptographic improvements for ANP sessions, constant-time comparison for secrets, transaction isolation for DB ops, and comprehensive input validation using Zod schemas. The changes maintain the existing agent sandbox model while eliminating the primary attack surfaces that could lead to RCE, credential exfiltration, or session hijacking.

[Types]
Introduce strict TypeScript interfaces and Zod schemas for all security boundaries.

New types include:
- `SecureCommandContext`: { command: string; userId: string; sessionId: string; permissions: string[]; timeoutMs: number; traceId: string }
- `PolicyEvaluationResult`: { allowed: boolean; reason: string; classification: 'safe' | 'review' | 'blocked'; normalizedCommand?: string; riskScore: number; mitigations: string[] }
- `SanitizedToken`: branded string type with runtime validation (using zod.brand())
- `AnpCryptoOptions`: { algorithm: 'aes-256-gcm'; keyRotationDays: number; minEntropyBits: 256 }
- `AuditEvent`: { timestamp: Date; actor: string; action: string; target: string; outcome: 'success' | 'failure'; metadata: Record<string, unknown> }
Validation rules: All commands must pass both regex + AST validation; JWTs must use RS256 with 15min expiry and audience validation; secrets must never touch logs or unredacted responses.

[Files]
Modify 9 core security files and create 3 new modules.

New files:
- src/security/CommandASTValidator.ts (new AST-based parser for PowerShell/Bash, purpose: replace fragile regex)
- src/security/SecureContextValidator.ts (Zod schemas + runtime guards for all agent inputs)
- src/security/CryptoRotationService.ts (key rotation and constant-time ops)

Existing files to be modified:
- src/policy/CommandPolicy.ts (replace evaluate() and normalizeCommand() with layered validation, add AST check)
- src/policy/SecretPolicy.ts (strengthen redaction patterns, add context-aware scanning)
- src/security/anp/AnpCrypto.ts (replace weak crypto primitives with AES-GCM + proper IV/nonce handling)
- src/sandbox/GondolinSandbox.ts (add race-condition guards using mutexes and transaction IDs)
- src/security/AnpReplayProtection.ts (enhance nonce storage with Redis TTL)
- apps/control-plane/src/auth/TokenService.ts (fix JWT signing, add audience/issuer checks, implement refresh token rotation)
- src/redaction/RedactionEngine.ts (make redaction mandatory on all output paths)
- lib/safeUrl.ts (extend SSRF protection to all HTTP clients)

No files will be deleted. Update tsconfig.json and vitest.config.ts for new test coverage thresholds.

[Functions]
Update 12 critical security functions and add 5 new ones.

New functions:
- `validateCommandAST(command: string, context: SecureCommandContext): PolicyEvaluationResult` (src/security/CommandASTValidator.ts, purpose: structural validation beyond regex)
- `sanitizeWithContext(input: string, context: SecureCommandContext): string` (src/security/SecureContextValidator.ts)
- `rotateKeys(currentKey: Buffer): Promise<Buffer>` (src/security/CryptoRotationService.ts)
- `verifyWithConstantTime(a: Buffer, b: Buffer): boolean` (added to AnpCrypto.ts)
- `enforceTransactionIsolation(runId: string)` (src/sandbox/GondolinSandbox.ts)

Modified functions:
- `evaluate(command: string)` in src/policy/CommandPolicy.ts (must now accept SecureCommandContext, combine regex+AST, return PolicyEvaluationResult with riskScore)
- `normalizeCommand(command: string)` in src/policy/CommandPolicy.ts (deprecate in favor of sanitizeWithContext, keep only for backward compat)
- `encryptPayload()` and `decryptPayload()` in src/security/anp/AnpCrypto.ts (must use AES-GCM with authenticated data and proper key derivation)
- `executeCommand()` in src/sandbox/GondolinSandbox.ts (add mutex per sessionId to prevent race conditions)
- `validateToken()` in apps/control-plane/src/auth/TokenService.ts (add audience, issuer, exp+iat validation, reject HS256)
- `redact()` in src/redaction/RedactionEngine.ts (make it async and context-aware)

Removed functions: None (all deprecated paths will emit deprecation warnings for 2 releases).

[Classes]
Modify 4 core security classes.

New classes:
- `CommandASTValidator` (src/security/CommandASTValidator.ts, key methods: parseCommand(), isDestructive(), getRiskScore(); no inheritance)
- `SecureContextValidator` (src/security/SecureContextValidator.ts, key methods: validateInput(), createContext(); extends Zod schema factory)

Modified classes:
- `CommandPolicy` (src/policy/CommandPolicy.ts - add private astValidator: CommandASTValidator, update constructor to accept SecureContextValidator, modify evaluate() signature and internal classify() logic)
- `AnpCrypto` (src/security/anp/AnpCrypto.ts - add key rotation support, replace static methods with instance using CryptoRotationService)
- `GondolinSandbox` (src/sandbox/GondolinSandbox.ts - add mutex map and transaction tracking to prevent TOCTOU races)
- `TokenService` (apps/control-plane/src/auth/TokenService.ts - replace simple JWT usage with proper claims validation and refresh token handling)

No classes will be removed.

[Dependencies]
Add 2 new packages with strict version pinning; update 1 existing.

New packages:
- `zod@3.23.8` (for runtime schema validation at all security boundaries)
- `tree-sitter` + `tree-sitter-bash` + `tree-sitter-powershell` (for AST parsing in CommandASTValidator)

Update:
- `jsonwebtoken` to latest secure version with explicit algorithm enforcement

All changes must be declared in package.json with exact versions. No runtime dependencies on external crypto services.

[Testing]
Expand test coverage to 95%+ for all security modules with adversarial test cases.

Requirements:
- New test file: tests/SecurityHardening.test.ts (must include bypass attempts for every old regex, race condition simulations, crypto misuse vectors)
- Update existing: tests/CommandPolicy.test.ts, tests/AnpCrypto.test.ts, tests/SandboxSessionManager.test.ts, tests/NetworkPolicy.test.ts
- Add property-based testing with fast-check for command fuzzing
- Validation strategy: All tests must run in dry-run mode by default; include negative tests that would have succeeded under old policy but now fail

[Implementation Order]
Implement changes in strict dependency order to avoid breaking existing sandbox flows.

1. Create src/security/CommandASTValidator.ts and src/security/SecureContextValidator.ts with full test coverage.
2. Update src/policy/CommandPolicy.ts to integrate the new AST validator while preserving the existing evaluate() interface via adapter.
3. Harden src/policy/SecretPolicy.ts and src/redaction/RedactionEngine.ts.
4. Fix cryptographic primitives in src/security/anp/AnpCrypto.ts and add CryptoRotationService.ts.
5. Add race condition protections to src/sandbox/GondolinSandbox.ts and SandboxSessionManager.ts.
6. Strengthen authentication in apps/control-plane/src/auth/TokenService.ts, AuthMiddleware.ts and related admin routes.
7. Update all call sites in src/agent-runs/AgentRunService.ts, src/server.ts and src/security/* to pass SecureCommandContext.
8. Add comprehensive tests and update documentation in docs/security-model.md and docs/anp-hardening.md.
9. Run full test suite (npm test && npm run test:e2e) and security scan before marking complete.