import { Badge } from "@heroui/react";
import { Clock3, FileText, Image as ImageIcon, Link2, Mail, X } from "lucide-react";
import { DialogClose } from "@/components/ui/dialog";
import { OracleAvatar } from "../../components/primitives/OracleAvatar";

interface ConversationProfileCardProps {
  name: string;
  description: string;
  avatarSeed: string;
  emailOrDetail: string;
  initials: string;
  presenceStatus: string;
}

export function ConversationProfileCard({
  name,
  description,
  avatarSeed,
  emailOrDetail,
  initials,
  presenceStatus,
}: ConversationProfileCardProps) {
  const presenceOnline = presenceStatus === "online";
  const presenceLabel = presenceOnline ? "Online" : "Offline";
  const localTime = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date());

  return (
    <section className="oa-conversation-profile-card-wrap w-full mx-auto" aria-label={`${name} profile card`}>
      <div className="oa-conversation-profile-card rounded-[2rem] overflow-hidden">
        <div className="oa-conversation-profile-cover relative overflow-hidden" aria-hidden="true" />
        <DialogClose asChild>
          <button type="button" className="oa-conversation-profile-close" aria-label="Close profile card">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </DialogClose>
        <div className="oa-conversation-profile-body">
          <div className="oa-conversation-profile-avatar relative">
            <Badge.Anchor className="oa-conversation-profile-avatar-anchor">
              <OracleAvatar
                seed={avatarSeed}
                initials={initials}
                size="md"
                className="oa-conversation-profile-avatar-image rounded-full"
              />
              <Badge
                aria-label={presenceLabel}
                color={presenceOnline ? "success" : "danger"}
                placement="bottom-right"
                size="md"
                className={`oa-conversation-profile-presence ${presenceOnline ? "oa-conversation-profile-presence-online" : "oa-conversation-profile-presence-offline"}`}
              />
            </Badge.Anchor>
          </div>
          <div className="oa-conversation-profile-copy">
            <h2>{name}</h2>
            <p>{description}</p>
          </div>
          <div className="oa-conversation-profile-meta" aria-label="Profile details">
            <div className="oa-conversation-profile-meta-row">
              <span className={`oa-conversation-profile-active-dot ${presenceOnline ? "online" : "offline"}`} aria-hidden="true" />
              <span>{presenceOnline ? "Active" : "Offline"}</span>
            </div>
            <div className="oa-conversation-profile-meta-row">
              <Clock3 className="oa-conversation-profile-meta-icon" aria-hidden="true" />
              <span>{localTime} local time</span>
            </div>
            <div className="oa-conversation-profile-meta-row">
              <Mail className="oa-conversation-profile-meta-icon" aria-hidden="true" />
              <span>{emailOrDetail}</span>
            </div>
          </div>
          <div className="oa-conversation-profile-actions" aria-label="Profile shortcuts">
            <button type="button" className="oa-conversation-profile-action" aria-label="Documents">
              <FileText aria-hidden="true" />
              <span>Documents</span>
            </button>
            <button type="button" className="oa-conversation-profile-action" aria-label="Media">
              <ImageIcon aria-hidden="true" />
              <span>Media</span>
            </button>
            <button type="button" className="oa-conversation-profile-action" aria-label="Links">
              <Link2 aria-hidden="true" />
              <span>Links</span>
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
