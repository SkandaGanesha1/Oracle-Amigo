export interface SavedTimelineScroll {
  scrollTop: number;
  anchorMessageId?: string;
  anchorOffset?: number;
}

const timelineScrollByConversation = new Map<string, SavedTimelineScroll>();

export function saveTimelineScroll(conversationId: string, scroll: SavedTimelineScroll): void {
  timelineScrollByConversation.set(conversationId, scroll);
}

export function getTimelineScroll(conversationId: string): SavedTimelineScroll | undefined {
  return timelineScrollByConversation.get(conversationId);
}

export { timelineScrollByConversation };
