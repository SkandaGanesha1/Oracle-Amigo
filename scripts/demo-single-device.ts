/**
 * Single-device demo script.
 * Tests: init profile, index files, search, approve, audit chain, feedback loop, rebind.
 *
 * Usage: npx tsx scripts/demo-single-device.ts
 */
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { buildServer } from "../src/server.js";

const demoDir = join(tmpdir(), `demo-single-${Date.now()}`);
const storageDir = join(demoDir, "storage");
const keysDir = join(demoDir, "keys");
mkdirSync(storageDir, { recursive: true });
mkdirSync(keysDir, { recursive: true });

// Create a test file
const testDir = join(demoDir, "docs");
mkdirSync(testDir, { recursive: true });
writeFileSync(join(testDir, "API_Design_Final.pdf"), "Fake PDF content for demo");
writeFileSync(join(testDir, "quarterly_report.xlsx"), "Fake XLSX content");
writeFileSync(join(testDir, "readme.md"), "# Demo project");
writeFileSync(join(testDir, "client_invoice_2024.pdf"), "2024 client invoice records");

process.env.AGENTIC_DB_PATH = join(demoDir, "oracle-amigo.db");
process.env.AGENTIC_STORAGE_ROOT = storageDir;
process.env.LOCALAPPDATA = demoDir;
process.env.SANDBOX_PORT = "3399";
process.env.NODE_ENV = "test";

const server = buildServer();
await server.listen({ host: "127.0.0.1", port: 3399 });
const base = "http://127.0.0.1:3399";

let exitCode = 0;
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`ASSERTION FAILED: ${msg}`);
    exitCode = 1;
  } else {
    console.log(`  ✓ ${msg}`);
  }
}

try {
  // 1. Health check
  const health = await (await fetch(`${base}/health`)).json();
  console.log("Health:", JSON.stringify(health));
  assert(health?.status === "ok", "health endpoint returns status=ok");

  // 2. Init profile
  const profile = await (await fetch(`${base}/profile/init`, { method: "POST" })).json();
  console.log("Profile:", JSON.stringify(profile.identity, null, 2));
  assert(profile?.identity?.agentId, "profile.init returns identity.agentId");

  // 3. Get agent card
  const card = await (await fetch(`${base}/.well-known/agent-card.json`)).json();
  console.log("Agent Card:", JSON.stringify({ name: card.name, protocolVersion: card.protocolVersion, version: card.version, preferredTransport: card.preferredTransport }));
  assert(card?.protocolVersion === "0.3.0", "agent-card has A2A v0.3.0 protocolVersion");
  assert(card?.preferredTransport === "JSONRPC", "agent-card has JSONRPC as preferred transport");

  // 4. Index files
  const indexResult = await (await fetch(`${base}/files/index-roots`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roots: [testDir] }),
  })).json();
  console.log("Indexed:", JSON.stringify(indexResult.roots?.[0] ?? indexResult));
  assert((indexResult.roots?.[0]?.indexed ?? 0) >= 4, "indexed at least 4 files");

  // 5. Search
  const searchResult = await (await fetch(`${base}/files/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: "API design document" }),
  })).json();
  console.log(`Search results: ${searchResult.length} candidate(s)`);
  for (const r of searchResult.slice(0, 3)) {
    console.log(`  - ${r.fileName} (${Math.round(r.score * 100)}%) - ${r.reason}`);
  }
  assert(searchResult.length > 0, "search returns at least one candidate");

  // 6. Chat file request → approval flow
  const chatResult = await (await fetch(`${base}/chat/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "find API design PDF" }),
  })).json();
  console.log("Chat result type:", chatResult.type);
  assert(chatResult.type === "approval_required", "chat produced approval_required type");
  assert(chatResult.approvalId, "approvalId is present");
  assert(chatResult.candidates?.length > 0, "candidates are present");

  // 7. Feedback: "no, I want the invoice, not the design doc"
  if (chatResult.approvalId && chatResult.candidates?.length > 0) {
    const topId = chatResult.candidates[0].id;
    const fbResult = await (await fetch(`${base}/approvals/${chatResult.approvalId}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedback: "no, I want the invoice not the design", rejectedFileIds: [topId] }),
    })).json();
    console.log(`Feedback refined ${fbResult.candidates?.length ?? 0} candidate(s); new approval ${fbResult.newApproval?.id}`);
    assert(fbResult.newApproval, "feedback created new approval");
    assert(fbResult.candidates?.length > 0, "feedback returned new candidates");
    assert(fbResult.candidates[0].id !== topId, "refined top candidate differs from rejected");

    // 8. Approve the refined candidate
    const approved = await (await fetch(`${base}/approvals/${fbResult.newApproval.id}/approve`, { method: "POST" })).json();
    console.log("Approval result:", approved.status);
    assert(approved.status === "approved", "refined approval was approved");

    // Wait briefly for storage pipeline
    await new Promise((r) => setTimeout(r, 500));
  }

  // 9. Re-bind + approve a different file (Choose Manually flow)
  const chat2 = await (await fetch(`${base}/chat/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "find readme" }),
  })).json();
  if (chat2.approvalId) {
    const indexed = await (await fetch(`${base}/files/indexed?limit=50`)).json();
    const target = indexed.items?.find((i: { fileName: string }) => i.fileName === "readme.md") ?? indexed.items?.[0];
    if (target) {
      const rebind = await (await fetch(`${base}/approvals/${chat2.approvalId}/rebind-file`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId: target.id }),
      })).json();
      console.log(`Rebound to ${rebind.boundFilePath?.split(/[\\/]/).pop() ?? "?"}, sha256=${rebind.boundSha256?.slice(0, 12)}...`);
      assert(rebind.boundFilePath?.endsWith(target.fileName), "rebind bound to the new file");
      assert(rebind.boundSha256, "rebind computed a sha256");
      const approved2 = await (await fetch(`${base}/approvals/${chat2.approvalId}/approve`, { method: "POST" })).json();
      assert(approved2.status === "approved", "manually-rebound approval was approved");
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  // 10. Notification callback idempotency
  const pending = await (await fetch(`${base}/approvals/pending`)).json();
  console.log(`Pending approvals: ${pending.approvals?.length ?? 0}`);
  if (pending.approvals?.length > 0) {
    const ap = pending.approvals[0];
    const cb1 = await (await fetch(`${base}/approvals/notification-callback`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approvalId: ap.id, taskId: ap.taskId, action: "reject" }),
    })).json();
    const cb2 = await (await fetch(`${base}/approvals/notification-callback`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approvalId: ap.id, taskId: ap.taskId, action: "reject" }),
    })).json();
    assert(cb1.replay === false, "first callback returns replay=false");
    assert(cb2.replay === true, "second callback returns replay=true (idempotent)");
  }

  // 11. Audit events
  const audit = await (await fetch(`${base}/audit/events`)).json();
  console.log(`Audit events: ${audit.events.length} event(s)`);
  assert(audit.events.length > 5, "audit chain has multiple events");
  for (const e of audit.events.slice(0, 8)) {
    console.log(`  #${e.id}: ${e.eventType} by ${e.actorAgentId}`);
  }

  // 12. Stored files
  const stored = await (await fetch(`${base}/storage/files`)).json();
  console.log(`Stored files: ${stored.files.length} file(s)`);
  for (const f of stored.files) {
    console.log(`  - ${f.originalFileName} (${f.sha256.slice(0, 12)}...)`);
  }
  assert(stored.files.length >= 1, "at least one file was stored end-to-end");
} finally {
  await server.close();
  console.log(`\nDemo complete. ${exitCode === 0 ? "✓ ALL CHECKS PASSED" : "✗ FAILURES — see above"}`);
  process.exit(exitCode);
}
