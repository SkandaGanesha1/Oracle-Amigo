import { ArrowRight, KeyRound, LifeBuoy, ShieldCheck } from "lucide-react";
import { useEffect, useState, type FC, type FormEvent } from "react";
import { loginStep1, verifyMfaRecovery, verifyMfaTotp } from "./api";
import { ApiError } from "../api/client";
import { isMfaRequired, type AdminSessionUser, type RecoveryVerifyResponse } from "./types";

type Stage = "password" | "totp" | "recovery";

interface Props {
  onAuthenticated: (user: AdminSessionUser, options?: { newRecoveryCodes?: string[] }) => void;
}

export const LoginFlow: FC<Props> = ({ onAuthenticated }) => {
  const [stage, setStage] = useState<Stage>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    setInfo(null);
  }, [stage]);

  const submitPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      const res = await loginStep1(email.trim().toLowerCase(), password);
      if (isMfaRequired(res)) {
        setChallenge(res.challenge);
        setStage("totp");
        setInfo("Enter the 6-digit code from your authenticator app.");
      } else {
        onAuthenticated(res.user);
      }
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError(err instanceof Error ? err.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !challenge) return;
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      if (stage === "totp") {
        const res = await verifyMfaTotp(challenge, code.trim());
        onAuthenticated(res.user);
      } else if (stage === "recovery") {
        const res = await verifyMfaRecovery(challenge, code.trim().toUpperCase());
        onAuthenticated(res.user, { newRecoveryCodes: res.recovery_codes });
      }
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError(err instanceof Error ? err.message : "Verification failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex w-full max-w-sm flex-col gap-5 rounded-2xl border border-white/10 bg-[#0a0a0c]/90 p-6 shadow-2xl">
      <header className="flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-emerald-400/15">
          <ShieldCheck className="h-4 w-4 text-emerald-300" />
        </div>
        <div>
          <h1 className="text-sm font-semibold text-white">Oracle Amigo Admin</h1>
          <p className="text-[11px] text-white/45">Sign in to the control plane.</p>
        </div>
      </header>

      {stage === "password" && (
        <form onSubmit={submitPassword} className="flex flex-col gap-3">
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
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded-md border border-white/10 bg-black/40 px-2.5 py-2 text-sm text-white outline-none focus:border-emerald-400/60"
            />
          </label>
          {error && <p className="text-[11px] text-rose-300">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center justify-center gap-1.5 rounded-md border border-emerald-400/30 bg-emerald-400/15 px-3 py-2 text-xs font-medium text-emerald-100 transition hover:bg-emerald-400/25 disabled:opacity-60"
          >
            Continue
            <ArrowRight className="h-3 w-3" />
          </button>
        </form>
      )}

      {stage === "totp" && (
        <form onSubmit={submitCode} className="flex flex-col gap-3">
          <p className="text-[11px] text-white/55">
            Two-factor code for <span className="text-white/85">{email}</span>
          </p>
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
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => {
                setStage("recovery");
                setCode("");
                setInfo("Enter one of the 10 recovery codes you saved at setup.");
              }}
              className="text-[11px] text-white/55 underline-offset-2 hover:text-white hover:underline"
            >
              Use a recovery code
            </button>
            <button
              type="submit"
              disabled={busy || code.length !== 6}
              className="inline-flex items-center justify-center gap-1.5 rounded-md border border-emerald-400/30 bg-emerald-400/15 px-3 py-2 text-xs font-medium text-emerald-100 transition hover:bg-emerald-400/25 disabled:opacity-60"
            >
              Verify
              <ArrowRight className="h-3 w-3" />
            </button>
          </div>
        </form>
      )}

      {stage === "recovery" && (
        <form onSubmit={submitCode} className="flex flex-col gap-3">
          <p className="text-[11px] text-white/55">
            <LifeBuoy className="mr-1 inline h-3 w-3" />
            Recovery code for <span className="text-white/85">{email}</span>
          </p>
          <label className="flex flex-col gap-1 text-[11px] uppercase tracking-wider text-white/40">
            Recovery code
            <input
              type="text"
              autoFocus
              required
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              className="rounded-md border border-white/10 bg-black/40 px-2.5 py-2 text-center text-sm font-mono tracking-wider text-white outline-none focus:border-emerald-400/60"
            />
          </label>
          {info && <p className="text-[11px] text-white/55">{info}</p>}
          {error && <p className="text-[11px] text-rose-300">{error}</p>}
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => {
                setStage("totp");
                setCode("");
                setInfo("Enter the 6-digit code from your authenticator app.");
              }}
              className="text-[11px] text-white/55 underline-offset-2 hover:text-white hover:underline"
            >
              Use authenticator
            </button>
            <button
              type="submit"
              disabled={busy || code.trim().length === 0}
              className="inline-flex items-center justify-center gap-1.5 rounded-md border border-emerald-400/30 bg-emerald-400/15 px-3 py-2 text-xs font-medium text-emerald-100 transition hover:bg-emerald-400/25 disabled:opacity-60"
            >
              Verify
              <ArrowRight className="h-3 w-3" />
            </button>
          </div>
        </form>
      )}
    </div>
  );
};
