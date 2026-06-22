/// <reference types="vitest/globals" />
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MessageAttachments } from "../components/stream-like/MessageAttachments";
import { PdfMessageCard } from "../features/files/PdfMessageCard";
import type { MessageAttachment } from "../types";

function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function pdfAttachment(overrides: Partial<MessageAttachment> = {}): MessageAttachment {
  return {
    id: "",
    file_name: "quarterly-report.pdf",
    mime_type: "application/pdf",
    size_bytes: 1024 * 1024,
    url: "",
    scan_state: "unknown",
    ...overrides
  };
}

describe("PdfMessageCard", () => {
  it("renders blocked PDFs without attempting to show a preview", () => {
    renderWithQuery(<PdfMessageCard attachment={pdfAttachment({ id: "file-1", scan_state: "blocked" })} />);
    expect(screen.getByText("quarterly-report.pdf")).toBeInTheDocument();
    expect(screen.getByText("Blocked by file safety validation")).toBeInTheDocument();
  });

  it("renders a stable processing card while preview generation is pending", () => {
    renderWithQuery(<PdfMessageCard attachment={pdfAttachment()} />);
    expect(screen.getByText("Preparing preview")).toBeInTheDocument();
    expect(screen.getByText("quarterly-report.pdf")).toBeInTheDocument();
    expect(screen.getByText("1.0 MB")).toBeInTheDocument();
  });

  it("routes PDF attachments through the PDF card", () => {
    renderWithQuery(<MessageAttachments attachments={[pdfAttachment()]} />);
    expect(screen.getByText("Preparing preview")).toBeInTheDocument();
  });
});
