import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
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

const components: Components = {
  a({ children, href, ...props }) {
    return (
      <a href={href} target="_blank" rel="noreferrer" {...props}>
        {children}
      </a>
    );
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
