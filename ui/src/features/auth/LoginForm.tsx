import { useState } from "react";
import { Link } from "react-router-dom";
import { Eye, EyeOff, Mail, Lock } from "lucide-react";
import { OracleButton } from "../../components/primitives/OracleButton";
import { OracleSurface } from "../../components/primitives/OracleSurface";
import { ControlPlaneUrlField } from "./ControlPlaneUrlField";
import { loginSchema, type LoginInput } from "./schemas";

interface LoginFormProps {
  onSubmit: (input: LoginInput) => Promise<void>;
  isLoading: boolean;
  error: string | null;
}

export function LoginForm({ onSubmit, isLoading, error }: LoginFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [controlPlaneUrl, setControlPlaneUrl] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function validate(): LoginInput | null {
    const result = loginSchema.safeParse({ email: email.trim(), password, controlPlaneUrl: controlPlaneUrl.trim() });
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
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="login-email" className="text-xs font-medium text-oa-text-secondary">
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
            className="w-full rounded-lg border border-oa-border bg-oa-bg-elevated py-2 pl-10 pr-3 text-sm text-oa-text placeholder-oa-text-disabled transition-colors focus:border-oa-blue focus:outline-none"
            autoComplete="email"
            autoFocus
          />
        </div>
        {fieldErrors.email && <p className="text-xs text-oa-red">{fieldErrors.email}</p>}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="login-password" className="text-xs font-medium text-oa-text-secondary">
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
            className="w-full rounded-lg border border-oa-border bg-oa-bg-elevated py-2 pl-10 pr-10 text-sm text-oa-text placeholder-oa-text-disabled transition-colors focus:border-oa-blue focus:outline-none"
            autoComplete="current-password"
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-oa-text-muted transition-colors hover:text-oa-text"
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        {fieldErrors.password && <p className="text-xs text-oa-red">{fieldErrors.password}</p>}
      </div>

      <ControlPlaneUrlField
        value={controlPlaneUrl}
        onChange={setControlPlaneUrl}
        error={fieldErrors.controlPlaneUrl ?? null}
      />

      {error && (
        <OracleSurface elevation="card" className="border-oa-red/30 bg-oa-red/10 p-3">
          <p className="text-xs text-oa-red">{error}</p>
        </OracleSurface>
      )}

      <OracleButton
        oaVariant="primary"
        className="h-10 w-full"
        isPending={isLoading}
        isDisabled={isLoading}
        type="submit"
      >
        Log In
      </OracleButton>

      <p className="text-center text-xs text-oa-text-muted">
        Don't have an account?{" "}
        <Link to="/signup" className="text-oa-blue transition-colors hover:text-oa-cyan">
          Sign up
        </Link>
      </p>
    </form>
  );
}
