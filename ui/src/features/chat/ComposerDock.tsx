import { MessageComposer } from "../../components/stream-like/MessageComposer";
import { OfflineOutbox } from "./OfflineOutbox";

interface ComposerDockProps {
  conversationId: string;
  onSend: (text: string, sendAs: "normal" | "file_request") => Promise<void>;
  disabled?: boolean;
}

export function ComposerDock({ conversationId, onSend, disabled }: ComposerDockProps) {
  return (
    <div className="flex flex-col">
      <MessageComposer
        conversationId={conversationId}
        onSend={onSend}
        disabled={disabled}
      />
    </div>
  );
}
