# Implementation Plan

[Overview]
Implement a protected /cloud/contacts GET endpoint to manage local agent contacts within the hybrid cloud facade, fixing the frontend 401 Unauthorized error by integrating with the existing DID/JWT authentication system.

The Oracle Amigo project is a TypeScript/Node personal agent sandbox with hybrid local/cloud architecture (src/cloud/, src/security/, src/server.ts entrypoint). The frontend (Vite/React in ui/, bundled to public/) uses TanStack Query to call /cloud/contacts but receives 401 because the route is not registered or lacks proper auth middleware. This endpoint must handle local contact storage/retrieval (not external sync like Google) while enforcing DID-based auth per AGENTS.md security rules. The implementation will add a CloudContactsService, register it under protected routes in the Fastify server, update frontend auth headers, add Zod validation, comprehensive tests, and ensure no secret leakage or sandbox bypass. This fits the LocalCloudFacade pattern seen in tests/LocalCloudFacade.test.ts and maintains production boundary documented in docs/local-agent-production-boundary.md.

[Types]
Define TypeScript interfaces and Zod schemas for contact data and API responses.

```ts
interface AgentContact {
  id: string; // UUID or DID-derived
  name: string;
  did?: string; // optional decentralized identifier
  email?: string;
  phone?: string;
  metadata?: Record<string, any>; // tags, lastSync, etc.
  createdAt: Date;
  updatedAt: Date;
}

interface ContactsResponse {
  contacts: AgentContact[];
  total: number;
  page?: number;
  limit?: number;
}

// Zod schemas for validation (used at API boundary per AGENTS.md)
const ContactSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  did: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  metadata: z.record(z.any()).optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

const ContactsQuerySchema = z.object({
  limit: z.number().int().positive().default(50),
  offset: z.number().int().nonnegative().default(0),
});
```

[Files]
Create and modify files to add the contacts endpoint with auth.

- New: src/cloud/contacts.ts (service implementation for CRUD on local contacts)
- New: src/cloud/types.ts (if not present, extend with Contact types)
- Modified: src/server.ts (register /cloud/contacts route with auth middleware)
- Modified: src/cloud/index.ts (export new service, integrate with LocalCloudFacade)
- Modified: src/security/auth.ts (ensure DID/JWT middleware passes correct context)
- Modified: ui/src/hooks/useContacts.ts or equivalent query file (add auth token to queryFn)
- Modified: tests/CloudClients.test.ts (add contacts test cases)
- Modified: tests/LocalCloudFacade.test.ts (update facade tests)
- No files to delete. Update package.json only if new deps needed (none anticipated).

[Functions]
Add and modify functions for contact management and auth.

- New: getContacts (src/cloud/contacts.ts, async (req: FastifyRequest) => Promise<ContactsResponse>, purpose: fetch authenticated user's local contacts from DB/storage)
- New: storeContact (src/cloud/contacts.ts, async (contact: AgentContact) => Promise<void>)
- Modified: setupCloudRoutes (src/server.ts, add app.get('/cloud/contacts', authMiddleware, contactsHandler))
- Modified: createCloudFacade (src/cloud/index.ts, add contactsService to facade object)
- Modified: validateDIDToken (src/security/auth.ts, ensure it attaches user DID to request context for contacts)
- Removed: none.

[Classes]
Extend existing service classes for contacts.

- New: CloudContactsService (src/cloud/contacts.ts, key methods: getContacts, storeContact, searchContacts; depends on StorageService and SecurityContext)
- Modified: LocalCloudFacade (src/cloud/index.ts or facade class, add contacts: CloudContactsService property and delegate methods)
- Modified: AgentServer (src/server.ts, ensure auth plugin is applied before cloud routes)
- Removed: none.

[Dependencies]
No new packages required; leverage existing zod, fastify, @libp2p/crypto, and local storage abstractions already in package.json.

Existing deps (from root package.json): typescript, fastify, zod, vitest, @tanstack/react-query (frontend). Ensure DID auth libraries are imported correctly.

[Testing]
Use Vitest to add unit + E2E tests verifying auth enforcement and contact CRUD.

- New test cases in tests/CloudClients.test.ts for 200 with valid DID vs 401 without
- Update tests/LocalCloudFacade.test.ts to cover contacts delegation
- Add E2E coverage in tests/e2e/chat-frontend.spec.js for frontend query with mocked auth
- Validate with npm test and npm run test:e2e; ensure 80%+ coverage on new code per AGENTS.md.

[Implementation Order]
Implement in this order to avoid route/auth conflicts and enable incremental testing.

1. Create src/cloud/contacts.ts with types, service class, and handlers (use existing storage patterns).
2. Update src/cloud/index.ts to export and integrate CloudContactsService into facade.
3. Modify src/server.ts to register protected /cloud/contacts route using existing auth middleware.
4. Update frontend query (ui/ or public bundled code) to include DID/JWT token in Authorization header.
5. Add/update tests in CloudClients.test.ts and LocalCloudFacade.test.ts.
6. Run typecheck, tests, and manual verification of the endpoint with valid auth.
7. Update implementation_plan.md and docs if new patterns emerge.
8. Verify no 401 in browser dev tools and that contacts load correctly in UI.