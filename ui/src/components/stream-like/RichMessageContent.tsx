import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Children, isValidElement, type ReactNode } from "react";
import { AgentCodeBlock } from "../agentic-ai/AgentCodeBlock";
import { safeDisplayText } from "../../lib/safeText";

const allowedProtocols = new Set(["http:", "https:", "mailto:", "tel:"]);

function safeUrlTransform(url: string): string {
  const trimmed = url.trim();
  if (trimmed.startsWith("/") || trimmed.startsWith("#")) return trimmed;
  try {
    const parsed = new URL(trimmed);
    return allowedProtocols.has(parsed.protocol) ? trimmed : "";
  } catch {
    return "";
  }
}

const TOKEN_RE = /(^|[\s(])(@[A-Za-z0-9._-]{2,40}|#[A-Za-z0-9._-]{2,40}|&[A-Za-z0-9._-]{2,40})/g;

function mentionKind(token: string): "mention" | "channel" | "role" {
  if (token.startsWith("#")) return "channel";
  if (token.startsWith("&")) return "role";
  return "mention";
}

function renderInlineTokens(value: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = TOKEN_RE.exec(value)) !== null) {
    const prefix = match[1] ?? "";
    const token = match[2] ?? "";
    const tokenStart = match.index + prefix.length;
    if (tokenStart > lastIndex) nodes.push(value.slice(lastIndex, tokenStart));
    nodes.push(
      <span
        key={`${token}-${tokenStart}`}
        className="oa-message-token"
        data-token-kind={mentionKind(token)}
      >
        {token}
      </span>
    );
    lastIndex = tokenStart + token.length;
  }

  if (lastIndex < value.length) nodes.push(value.slice(lastIndex));
  return nodes;
}

function renderTextNodes(children: ReactNode): ReactNode {
  return Children.map(children, (child) => {
    if (typeof child === "string") return renderInlineTokens(child);
    if (isValidElement(child)) return child;
    return child;
  });
}

const components: Components = {
  a({ children, href, ...props }) {
    return (
      <a href={href} target="_blank" rel="noreferrer noopener" {...props}>
        {children}
      </a>
    );
  },
  p({ children, ...props }) {
    return <p {...props}>{renderTextNodes(children)}</p>;
  },
  code({ children, className, ...props }) {
    const code = String(children ?? "").replace(/\n$/, "");
    const language = /language-([A-Za-z0-9_-]+)/.exec(className ?? "")?.[1];
    if (!language) {
      return <code className={className} {...props}>{children}</code>;
    }
    return (
      <AgentCodeBlock
        code={code}
        language={language}
        showLineNumbers={code.includes("\n")}
        className="my-2"
      />
    );
  },
};

export function RichMessageContent({ text }: { text: string }) {
  return (
    <div className="rich-message break-words">
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        urlTransform={safeUrlTransform}
        components={components}
      >
        {safeDisplayText(text)}
      </Markdown>
    </div>
  );
}
