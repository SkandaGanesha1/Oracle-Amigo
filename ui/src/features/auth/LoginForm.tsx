import { useState } from "react";
import { Link } from "react-router-dom";
import { Eye, EyeOff, Mail, Lock } from "lucide-react";
import { OracleButton } from "../../components/primitives/OracleButton";
import { OracleSurface } from "../../components/primitives/OracleSurface";
import { loginSchema, type LoginInput } from "./schemas";

interface LoginFormProps {
  onSubmit: (input: LoginInput) => Promise<void>;
  isLoading: boolean;
  error: string | null;
}

export function LoginForm({ onSubmit, isLoading, error }: LoginFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function validate(): LoginInput | null {
    const result = loginSchema.safeParse({ email: email.trim(), password });
    if (!result.success) {
      const errors: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const field = issue.path[0] as string;
        if (!errors[field]) errors[field] = issue.message;
      }
      setFieldErrors(errors);
      return null;
    }
    setFieldErrors({});
    return result.data;
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const data = validate();
    if (data) void onSubmit(data);
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full flex-col gap-5" noValidate>
      <div className="flex flex-col gap-2">
        <label htmlFor="login-email" className="text-sm font-semibold text-oa-text">
          Email
        </label>
        <div className="relative">
          <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-oa-text-muted" />
          <input
            id="login-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.currentTarget.value)}
            placeholder="jane@example.com"
            className="min-h-[48px] w-full rounded-[10px] border border-oa-border-strong bg-oa-surface-2 py-3 pl-11 pr-3 text-base text-oa-text placeholder-oa-text-disabled transition-colors focus:border-oa-blue focus:outline-none focus:ring-2 focus:ring-oa-blue/45"
            autoComplete="email"
            aria-required="true"
            aria-describedby={fieldErrors.email ? "login-email-error" : undefined}
            aria-invalid={fieldErrors.email ? "true" : undefined}
            autoFocus
          />
        </div>
        {fieldErrors.email && <p id="login-email-error" className="text-xs text-oa-red" role="alert">{fieldErrors.email}</p>}
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="login-password" className="text-sm font-semibold text-oa-text">
          Password
        </label>
        <div className="relative">
          <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-oa-text-muted" />
          <input
            id="login-password"
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.currentTarget.value)}
            placeholder="Enter your password"
            className="min-h-[48px] w-full rounded-[10px] border border-oa-border bg-oa-surface-2 py-3 pl-11 pr-12 text-base text-oa-text placeholder-oa-text-disabled transition-colors focus:border-oa-blue focus:outline-none focus:ring-2 focus:ring-oa-blue/45"
            autoComplete="current-password"
            aria-required="true"
            aria-describedby={fieldErrors.password ? "login-password-error" : undefined}
            aria-invalid={fieldErrors.password ? "true" : undefined}
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-lg text-oa-text-muted transition-colors hover:text-oa-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue"
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        {fieldErrors.password && <p id="login-password-error" className="text-xs text-oa-red" role="alert">{fieldErrors.password}</p>}
      </div>

      {error && (
        <OracleSurface elevation="card" className="border-oa-red/30 bg-oa-red/10 p-3">
          <p className="text-xs text-oa-red">{error}</p>
        </OracleSurface>
      )}

      <OracleButton
        oaVariant="primary"
        className="mt-3 h-11 w-full"
        isPending={isLoading}
        isDisabled={isLoading}
        type="submit"
      >
        Log In
      </OracleButton>

      <p className="text-center text-sm text-oa-text-muted">
        Don't have an account?{" "}
        <Link to="/signup" className="text-oa-blue transition-colors hover:text-oa-cyan">
          Sign up
        </Link>
      </p>
    </form>
  );
}
