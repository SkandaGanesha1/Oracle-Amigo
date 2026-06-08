import type { ReactNode } from "react";
import type { CandidateFile, FileCandidateApprovalCard, TimelineMessage } from "../types";
import { EmptyState } from "./core";

export { AttachmentButton, DateSeparator, EmptyState, ErrorBoundary, SlashCommandMenu, ToastProvider, useToasts } from "./core";

export function AppShell({ children }: { children: ReactNode }) {
  return <main className="app-shell" aria-label="Oracle Amigo agentic chat application">{children}</main>;
}

export function ConnectionStatusBar({ children }: { children: ReactNode }) {
  return <div className="topbar-status" aria-label="Connection status">{children}</div>;
}

export function Sidebar({ children }: { children: ReactNode }) {
  return <aside className="sidebar" aria-label="Contacts and conversations">{children}</aside>;
}

export function ConversationList({ children }: { children: ReactNode }) {
  return <section className="conversation-list" aria-labelledby="conversations-title">{children}</section>;
}

export function ConversationListItem({ children }: { children: ReactNode }) {
  return <div className="conversation-row">{children}</div>;
}

export function DirectorySearch({ children }: { children: ReactNode }) {
  return <section className="directory-search" aria-labelledby="directory-title">{children}</section>;
}

export function ContactCard({ children }: { children: ReactNode }) {
  return <article className="person-row">{children}</article>;
}

export function ChatWindow({ children }: { children: ReactNode }) {
  return <section className="chat-window">{children}</section>;
}

export function MessageTimeline({ children }: { children: ReactNode }) {
  return <div className="message-scroll" role="log" aria-live="polite" aria-relevant="additions text">{children}</div>;
}

export function VirtualizedMessageList({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function MessageBubble({ message }: { message: Extract<TimelineMessage, { kind: "human" }> }) {
  return <article className={`bubble human ${message.delivery_status === "failed" ? "failed" : ""}`}><p>{message.text}</p></article>;
}

export function AgentActivityBubble({ text, phase }: { text: string; phase: string }) {
  return <article className="bubble system"><p>{text}</p><span>{phase}</span></article>;
}

export function SystemEventBubble({ text, severity }: { text: string; severity: string }) {
  return <article className={`bubble system ${severity}`}><p>{text}</p></article>;
}

export function FileRequestBubble({ text, status }: { text: string; status: string }) {
  return <article className="task-card"><div /><div><strong>File request</strong><p>{text}</p><span>{status}</span></div></article>;
}

export function ApprovalCard({ card }: { card: FileCandidateApprovalCard }) {
  return <article className="approval-message"><h3>{card.request_text}</h3><CandidateFileList candidates={card.candidates} /></article>;
}

export function CandidateFileList({ candidates }: { candidates: CandidateFile[] }) {
  if (candidates.length === 0) return <EmptyState title="No candidates" text="Search again or choose a file manually." />;
  return <div className="candidate-list">{candidates.map((candidate) => <CandidateFileCard key={candidate.candidate_id} candidate={candidate} />)}</div>;
}

export function CandidateFileCard({ candidate }: { candidate: CandidateFile }) {
  return <div className="candidate-row"><div><strong>{candidate.file_name}</strong><span>{candidate.display_path}</span></div></div>;
}

export function FeedbackComposer({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <textarea value={value} onChange={(event) => onChange(event.target.value)} placeholder="Refine the search" />;
}

export function TransferProgressCard({ children }: { children: ReactNode }) {
  return <article className="file-card">{children}</article>;
}

export function FileReceiptCard({ children }: { children: ReactNode }) {
  return <article className="file-card">{children}</article>;
}

export function MessageComposer({ children }: { children: ReactNode }) {
  return <footer className="composer" aria-label="Message composer">{children}</footer>;
}

export function RightInspectorPanel({ children }: { children: ReactNode }) {
  return <aside className="details-panel" aria-label="Conversation details">{children}</aside>;
}

export function AgentCardPanel({ children }: { children: ReactNode }) {
  return <section className="panel-section">{children}</section>;
}

export function TaskTimelinePanel({ children }: { children: ReactNode }) {
  return <section className="panel-section">{children}</section>;
}

export function ReceivedFilesPanel({ children }: { children: ReactNode }) {
  return <section className="panel-section">{children}</section>;
}

export function AuditTimelinePanel({ children }: { children: ReactNode }) {
  return <section className="panel-section">{children}</section>;
}

export function ApprovalCenter({ children }: { children: ReactNode }) {
  return <section className="approval-center">{children}</section>;
}

export function SettingsPanel({ children }: { children: ReactNode }) {
  return <section className="panel-section settings-panel">{children}</section>;
}

export function DiagnosticsPanel({ children }: { children: ReactNode }) {
  return <section className="panel-section settings-panel">{children}</section>;
}

export function AuthScreen({ children }: { children: ReactNode }) {
  return <main className="auth-screen">{children}</main>;
}

export function SignupForm({ children }: { children: ReactNode }) {
  return <form className="form-grid">{children}</form>;
}

export function LoginForm({ children }: { children: ReactNode }) {
  return <form className="form-grid">{children}</form>;
}

export function DeviceEnrollmentScreen({ children }: { children: ReactNode }) {
  return <main className="auth-screen">{children}</main>;
}
