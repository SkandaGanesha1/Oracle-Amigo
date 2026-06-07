import { ArrowRight, Copy, KeyRound, ShieldCheck } from "lucide-react";
import { useEffect, useState, type FC, type FormEvent } from "react";
import { ApiError } from "../api/client";
import { setupFirstAdmin, startSetup } from "./api";
import { QrCode } from "./QrCode";
import type { SetupStartResponse } from "./types";

interface Props {
  onCompleted: (recoveryCodes: string[]) => void;
}

type Stage = "credentials" | "scan" | "codes";

function copy(value: string): void {
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    void navigator.clipboard.writeText(value).catch(() => undefined);
  }
}

export const SetupFlow: FC<Props> = ({ onCompleted }) => {
  const [stage, setStage] = useState<Stage>("credentials");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  const [setupStart, setSetupStart] = useState<SetupStartResponse | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (stage !== "scan" || setupStart) return;
    setError(null);
    setBusy(true);
    startSetup()
      .then((res) => setSetupStart(res))
      .catch((err: unknown) => {
        if (err instanceof ApiError) setError(err.message);
        else setError(err instanceof Error ? err.message : "Failed to start setup.");
      })
      .finally(() => setBusy(false));
  }, [stage, setupStart]);

  const submitCredentials = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (displayName.trim().length === 0) {
      setError("Display name is required.");
      return;
    }
    if (password.length < 12) {
      setError("Password must be at least 12 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setStage("scan");
  };

  const verifyTOTP = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !setupStart) return;
    setError(null);
    setBusy(true);
    try {
      const res = await setupFirstAdmin({
        email: email.trim().toLowerCase(),
        display_name: displayName.trim(),
        password,
        totp_code: code.trim(),
        setup_challenge: setupStart.challenge
      });
      setRecoveryCodes(res.recovery_codes);
      setStage("codes");
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError(err instanceof Error ? err.message : "Setup failed.");
    } finally {
      setBusy(false);
    }
  };

  const finish = () => {
    onCompleted(recoveryCodes);
  };

  return (
    <div className="flex w-full max-w-md flex-col gap-5 rounded-2xl border border-white/10 bg-[#0a0a0c]/90 p-6 shadow-2xl">
      <header className="flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-emerald-400/15">
          <ShieldCheck className="h-4 w-4 text-emerald-300" />
        </div>
        <div>
          <h1 className="text-sm font-semibold text-white">Bootstrap first admin</h1>
          <p className="text-[11px] text-white/45">This screen is shown only when no admin accounts exist.</p>
        </div>
      </header>

      {stage === "credentials" && (
        <form onSubmit={submitCredentials} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-[11px] uppercase tracking-wider text-white/40">
            Display name
            <input
              type="text"
              required
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="rounded-md border border-white/10 bg-black/40 px-2.5 py-2 text-sm text-white outline-none focus:border-emerald-400/60"
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] uppercase tracking-wider text-white/40">
            Email
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-md border border-white/10 bg-black/40 px-2.5 py-2 text-sm text-white outline-none focus:border-emerald-400/60"
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] uppercase tracking-wider text-white/40">
            Password
            <input
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded-md border border-white/10 bg-black/40 px-2.5 py-2 text-sm text-white outline-none focus:border-emerald-400/60"
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] uppercase tracking-wider text-white/40">
            Confirm password
            <input
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="rounded-md border border-white/10 bg-black/40 px-2.5 py-2 text-sm text-white outline-none focus:border-emerald-400/60"
            />
          </label>
          {error && <p className="text-[11px] text-rose-300">{error}</p>}
          <button
            type="submit"
            className="inline-flex items-center justify-center gap-1.5 rounded-md border border-emerald-400/30 bg-emerald-400/15 px-3 py-2 text-xs font-medium text-emerald-100 transition hover:bg-emerald-400/25"
          >
            Continue
            <ArrowRight className="h-3 w-3" />
          </button>
        </form>
      )}

      {stage === "scan" && (
        <form onSubmit={verifyTOTP} className="flex flex-col gap-4">
          <p className="text-[11px] text-white/55">
            Scan this QR code with an authenticator app (e.g. 1Password, Authy, Google Authenticator), then enter
            the 6-digit code it shows.
          </p>
          <div className="flex flex-col items-center gap-3">
            <div className="rounded-lg bg-white p-2">
              {setupStart ? (
                <QrCode value={setupStart.provisioning_uri} size={180} />
              ) : (
                <div
                  className="flex animate-pulse items-center justify-center rounded-md bg-white/5"
                  style={{ width: 180, height: 180 }}
                >
                  <span className="text-[10px] text-black/40">Generating secret…</span>
                </div>
              )}
            </div>
            {setupStart && (
              <div className="flex w-full items-center justify-between gap-2 rounded-md border border-white/10 bg-black/40 px-3 py-2 text-[11px] text-white/70">
                <span className="truncate font-mono">{setupStart.secret_base32}</span>
                <button
                  type="button"
                  onClick={() => copy(setupStart.secret_base32)}
                  className="inline-flex items-center gap-1 text-[10px] text-white/55 hover:text-white"
                  title="Copy secret"
                >
                  <Copy className="h-3 w-3" /> Copy
                </button>
              </div>
            )}
          </div>
          <label className="flex flex-col gap-1 text-[11px] uppercase tracking-wider text-white/40">
            <span className="flex items-center gap-1.5">
              <KeyRound className="h-3 w-3" /> 6-digit code
            </span>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              className="rounded-md border border-white/10 bg-black/40 px-2.5 py-2 text-center text-base font-mono tracking-[0.5em] text-white outline-none focus:border-emerald-400/60"
            />
          </label>
          {error && <p className="text-[11px] text-rose-300">{error}</p>}
          <button
            type="submit"
            disabled={busy || code.length !== 6 || !setupStart}
            className="inline-flex items-center justify-center gap-1.5 rounded-md border border-emerald-400/30 bg-emerald-400/15 px-3 py-2 text-xs font-medium text-emerald-100 transition hover:bg-emerald-400/25 disabled:opacity-60"
          >
            Activate admin
            <ArrowRight className="h-3 w-3" />
          </button>
        </form>
      )}

      {stage === "codes" && (
        <div className="flex flex-col gap-3">
          <p className="text-[11px] text-white/55">
            Save these 10 recovery codes. They are the only way to regain access if you lose your authenticator
            device. <span className="text-amber-200">This is the only time they will be shown.</span>
          </p>
          <div className="grid grid-cols-2 gap-1.5 rounded-md border border-amber-400/20 bg-amber-400/5 p-3 text-[11px] font-mono text-amber-100">
            {recoveryCodes.map((c) => (
              <span key={c}>{c}</span>
            ))}
          </div>
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => copy(recoveryCodes.join("\n"))}
              className="inline-flex items-center gap-1.5 text-[11px] text-white/55 hover:text-white"
            >
              <Copy className="h-3 w-3" /> Copy all
            </button>
            <button
              type="button"
              onClick={finish}
              className="inline-flex items-center justify-center gap-1.5 rounded-md border border-emerald-400/30 bg-emerald-400/15 px-3 py-2 text-xs font-medium text-emerald-100 transition hover:bg-emerald-400/25"
            >
              I have saved them
              <ArrowRight className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
