/// <reference types="vitest/globals" />
import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { TransferProgressCard } from "../features/transfers/TransferProgressCard";
import type { TransferProgressMessage } from "../types";

function makeTransfer(overrides: Partial<TransferProgressMessage> = {}): TransferProgressMessage {
  return {
    kind: "transfer",
    id: "t1",
    transfer_id: "tf1",
    task_id: "task1",
    file_name: "report.pdf",
    size_bytes: 102400,
    sha256: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
    progress_percent: 50,
    status: "uploading",
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("TransferProgressCard", () => {
  it("renders the file name and size", () => {
    render(<TransferProgressCard transfer={makeTransfer()} />);
    expect(screen.getByText("report.pdf")).toBeInTheDocument();
    expect(screen.getByText("100.0 KB")).toBeInTheDocument();
  });

  it("renders an active progress bar for uploading status", () => {
    render(<TransferProgressCard transfer={makeTransfer()} />);
    expect(screen.getByText("Transferring to recipient...")).toBeInTheDocument();
    expect(screen.getByText("Progress")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
  });

  it("renders preparing status text", () => {
    render(<TransferProgressCard transfer={makeTransfer({ status: "preparing", progress_percent: 10 })} />);
    expect(screen.getByText("Preparing file for transfer...")).toBeInTheDocument();
  });

  it("renders downloading status text", () => {
    render(<TransferProgressCard transfer={makeTransfer({ status: "downloading", progress_percent: 30 })} />);
    expect(screen.getByText("Receiving from sender...")).toBeInTheDocument();
  });

  it("renders verifying status text", () => {
    render(<TransferProgressCard transfer={makeTransfer({ status: "verifying", progress_percent: 80 })} />);
    expect(screen.getByText("Verifying file integrity...")).toBeInTheDocument();
  });

  it("renders completed state without status text and with Verified badge", () => {
    render(<TransferProgressCard transfer={makeTransfer({ status: "stored", progress_percent: 100 })} />);
    expect(screen.queryByText("Transferring to recipient...")).not.toBeInTheDocument();
    expect(screen.getByText("Verified")).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("renders failed state with error message and Tampered badge", () => {
    render(<TransferProgressCard transfer={makeTransfer({ status: "failed", progress_percent: 60 })} />);
    expect(screen.getByText("Transfer failed")).toBeInTheDocument();
    expect(screen.getByText("Tampered")).toBeInTheDocument();
  });

  it("clamps progress to 0–100 range", () => {
    render(<TransferProgressCard transfer={makeTransfer({ progress_percent: -10 })} />);
    expect(screen.getByText("0%")).toBeInTheDocument();
  });

  it("displays truncated SHA-256 hash", () => {
    render(<TransferProgressCard transfer={makeTransfer()} />);
    expect(screen.getByText(/SHA-256: abcdef1234567890/)).toBeInTheDocument();
  });

  it("renders the 'File Transfer' header", () => {
    render(<TransferProgressCard transfer={makeTransfer()} />);
    expect(screen.getByText("File Transfer")).toBeInTheDocument();
  });
});
