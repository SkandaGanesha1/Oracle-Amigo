import { useState } from "react";
import { Link } from "react-router-dom";
import { Eye, EyeOff, Mail, Lock, User } from "lucide-react";
import { OracleButton } from "../../components/primitives/OracleButton";
import { OracleSurface } from "../../components/primitives/OracleSurface";
import { ControlPlaneUrlField } from "./ControlPlaneUrlField";
import { signupSchema, type SignupInput } from "./schemas";

interface SignupFormProps {
  onSubmit: (input: SignupInput) => Promise<void>;
  isLoading: boolean;
  error: string | null;
}

export function SignupForm({ onSubmit, isLoading, error }: SignupFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [controlPlaneUrl, setControlPlaneUrl] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function validate(): SignupInput | null {
    const result = signupSchema.safeParse({ email: email.trim(), password, displayName: displayName.trim(), controlPlaneUrl: controlPlaneUrl.trim() });
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
        <label htmlFor="signup-display-name" className="text-xs font-medium text-oa-text-secondary">
          Display Name
        </label>
        <div className="relative">
          <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-oa-text-muted" />
          <input
            id="signup-display-name"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.currentTarget.value)}
            placeholder="Jane Doe"
            className="w-full rounded-lg border border-oa-border bg-oa-bg-elevated py-2 pl-10 pr-3 text-sm text-oa-text placeholder-oa-text-disabled transition-colors focus:border-oa-blue focus:outline-none"
            autoComplete="name"
            aria-required="true"
            aria-describedby={fieldErrors.displayName ? "signup-display-name-error" : undefined}
            aria-invalid={fieldErrors.displayName ? "true" : undefined}
            autoFocus
          />
        </div>
        {fieldErrors.displayName && <p id="signup-display-name-error" className="text-xs text-oa-red" role="alert">{fieldErrors.displayName}</p>}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="signup-email" className="text-xs font-medium text-oa-text-secondary">
          Email
        </label>
        <div className="relative">
          <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-oa-text-muted" />
          <input
            id="signup-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.currentTarget.value)}
            placeholder="jane@example.com"
            className="w-full rounded-lg border border-oa-border bg-oa-bg-elevated py-2 pl-10 pr-3 text-sm text-oa-text placeholder-oa-text-disabled transition-colors focus:border-oa-blue focus:outline-none"
            autoComplete="email"
            aria-required="true"
            aria-describedby={fieldErrors.email ? "signup-email-error" : undefined}
            aria-invalid={fieldErrors.email ? "true" : undefined}
          />
        </div>
        {fieldErrors.email && <p id="signup-email-error" className="text-xs text-oa-red" role="alert">{fieldErrors.email}</p>}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="signup-password" className="text-xs font-medium text-oa-text-secondary">
          Password
        </label>
        <div className="relative">
          <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-oa-text-muted" />
          <input
            id="signup-password"
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.currentTarget.value)}
            placeholder="At least 8 characters"
            className="w-full rounded-lg border border-oa-border bg-oa-bg-elevated py-2 pl-10 pr-10 text-sm text-oa-text placeholder-oa-text-disabled transition-colors focus:border-oa-blue focus:outline-none"
            autoComplete="new-password"
            aria-required="true"
            aria-describedby={fieldErrors.password ? "signup-password-error" : undefined}
            aria-invalid={fieldErrors.password ? "true" : undefined}
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
        {fieldErrors.password && <p id="signup-password-error" className="text-xs text-oa-red" role="alert">{fieldErrors.password}</p>}
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
        Create Account
      </OracleButton>

      <p className="text-center text-xs text-oa-text-muted">
        Already have an account?{" "}
        <Link to="/login" className="text-oa-blue transition-colors hover:text-oa-cyan">
          Log in
        </Link>
      </p>
    </form>
  );
}
