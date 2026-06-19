import type { ChatConversationRecord, ChatRepository } from "./ChatRepository.js";

export interface ConversationRepairResult {
  repaired: ChatConversationRecord[];
  aliases: Array<{ from: string; to: string }>;
}

export class ConversationRepairService {
  constructor(private readonly chatRepo: ChatRepository) {}

  repairCloudRelayDuplicates(): ConversationRepairResult {
    const repaired = new Map<string, ChatConversationRecord>();
    const aliases: Array<{ from: string; to: string }> = [];

    for (const conversation of this.chatRepo.listConversations()) {
      if (conversation.mode !== "cloud_relay") continue;
      const canonical = this.chatRepo.resolveCanonicalConversation(conversation.id);
      if (!canonical) continue;
      repaired.set(canonical.id, canonical);
      if (canonical.id !== conversation.id) {
        aliases.push({ from: conversation.id, to: canonical.id });
      }
    }

    return { repaired: Array.from(repaired.values()), aliases };
  }
}
