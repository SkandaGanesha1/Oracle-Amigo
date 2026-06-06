/**
 * Loopback two-agent demo script.
 * Simulates two devices with separate profiles, ANP handshake, and A2A task flow.
 *
 * Usage: npx tsx scripts/demo-loopback.ts
 */
import { startLoopbackAgents } from "../src/loopback/LoopbackTestHarness.js";

console.log("Starting two loopback agents...");
const harness = await startLoopbackAgents();

try {
  const baseA = `http://127.0.0.1:${harness.agentA.port}`;
  const baseB = `http://127.0.0.1:${harness.agentB.port}`;

  // 1. Init both profiles
  const profA = await (await fetch(`${baseA}/profile/init`, { method: "POST" })).json();
  console.log("Agent A identity:", profA.identity.agentId);

  const profB = await (await fetch(`${baseB}/profile/init`, { method: "POST" })).json();
  console.log("Agent B identity:", profB.identity.agentId);

  // 2. Both agent cards
  const cardA = await (await fetch(`${baseA}/.well-known/agent-card.json`)).json();
  const cardB = await (await fetch(`${baseB}/.well-known/agent-card.json`)).json();
  console.log("Agent A card:", cardA.name, cardA.version);
  console.log("Agent B card:", cardB.name, cardB.version);

  // 3. ANP handshake: Agent B creates offer
  const offerRes = await fetch(`${baseB}/anp/handshake/offer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ peer: profB.identity.agentId }),
  });
  const offer = await offerRes.json();
  console.log("Handshake offer created:", offer.offerId);

  // 4. Agent A verifies and responds
  const verifyOffer = await fetch(`${baseA}/anp/handshake/verify-offer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ offer, publicKey: profB.identity.publicKey }),
  });
  console.log("Offer verified:", (await verifyOffer.json()).ok);

  const responseRes = await fetch(`${baseA}/anp/handshake/response`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ offer }),
  });
  const response = await responseRes.json();
  console.log("Handshake response:", response.status);

  // 5. Agent B stores peer session
  const addPeer = await fetch(`${baseB}/profile/init`, { method: "POST" });
  const addPeerData = await addPeer.json();
  // Create peer session for agent A on agent B
  const sessionB = await fetch(`${baseB}/anp/handshake/offer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ peer: profA.identity.agentId }),
  });
  console.log("Session established");

  // 6. A2A: Agent A sends file request to Agent B
  const taskRes = await fetch(`${baseB}/a2a/v1`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: "find API design document", type: "file.request.search" }),
  });
  const task = await taskRes.json();
  console.log("A2A task created on Agent B:", task.task?.id ?? "unknown");

  if (task.task?.id) {
    const taskCheck = await (await fetch(`${baseB}/a2a/tasks/${task.task.id}`)).json();
    console.log("Task status:", taskCheck.result?.task?.status ?? taskCheck.task?.status ?? "unknown");
  }

  // 7. Audit chain
  const auditB = await (await fetch(`${baseB}/audit/verify`)).json();
  console.log("Agent B audit chain valid:", auditB.valid);

  // 8. Agent B's stored files
  const storedB = await (await fetch(`${baseB}/storage/files`)).json();
  console.log("Agent B stored files:", storedB.files.length);
} finally {
  await harness.cleanup();
  console.log("\nLoopback demo complete.");
}
