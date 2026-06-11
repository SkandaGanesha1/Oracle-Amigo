import { useNavigate } from "react-router-dom";
import { ConversationList } from "../../features/chat/ConversationList";
import { useConversations } from "../../hooks/queries";

interface ChannelListProps {
  activeConversationId?: string | null;
}

export function ChannelList({ activeConversationId }: ChannelListProps) {
  const navigate = useNavigate();
  const { data } = useConversations();
  const conversations = data?.conversations ?? [];

  return (
    <div className="flex flex-col" role="list" aria-label="Conversations">
      <ConversationList
        conversations={conversations}
        activeConversationId={activeConversationId ?? null}
        onSelect={(id) => navigate(`/chats/${id}`)}
      />
    </div>
  );
}
