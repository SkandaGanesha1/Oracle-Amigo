import { FileSearch, Target, User, FileText } from "lucide-react";
import type { FileRequestMessage as FileRequestMessageType } from "../../api/types";

interface FileRequestMessageProps {
  message: FileRequestMessageType;
}

export function FileRequestMessage({ message }: FileRequestMessageProps) {
  return (
    <section className="oa-agent-card compact" aria-label={`File request: ${message.natural_language_request}`}>
      <div className="oa-agent-card-header">
        <div className="min-w-0">
          <div className="oa-agent-card-kicker">File request</div>
          <h3 className="oa-agent-card-title">{message.natural_language_request}</h3>
        </div>
        <span className="oa-doc-chip">{message.status}</span>
      </div>

      <dl className="oa-agent-card-facts">
        <div>
          <dt><User size={13} aria-hidden="true" /> Requester</dt>
          <dd>{message.requester}</dd>
        </div>
        <div>
          <dt><Target size={13} aria-hidden="true" /> Target</dt>
          <dd>{message.target}</dd>
        </div>
        <div>
          <dt><FileText size={13} aria-hidden="true" /> Query</dt>
          <dd>&ldquo;{message.query}&rdquo;</dd>
        </div>
      </dl>

      <div className="oa-agent-card-footer">
        <button type="button" className="oa-doc-action" disabled>
          <FileSearch size={16} aria-hidden="true" />
          Preview request
        </button>
      </div>
    </section>
  );
}
