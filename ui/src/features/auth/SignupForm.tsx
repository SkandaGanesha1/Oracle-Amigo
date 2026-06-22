import { useState } from "react";
import { Link } from "react-router-dom";
import { Eye, EyeOff, Mail, Lock, User } from "lucide-react";
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
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function validate(): SignupInput | null {
    const result = signupSchema.safeParse({ email: email.trim(), password, displayName: displayName.trim() });
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
    <form onSubmit={handleSubmit} className="oa-auth-form" noValidate>
      <div className="oa-auth-field" data-invalid={fieldErrors.displayName ? "true" : undefined}>
        <label htmlFor="signup-display-name">
          Display Name
        </label>
        <div className="oa-auth-input-shell">
          <User className="oa-auth-input-icon" aria-hidden="true" />
          <input
            id="signup-display-name"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.currentTarget.value)}
            placeholder="Jane Doe"
            className="oa-auth-input"
            autoComplete="name"
            aria-required="true"
            aria-describedby={fieldErrors.displayName ? "signup-display-name-error" : undefined}
            aria-invalid={fieldErrors.displayName ? "true" : undefined}
            autoFocus
          />
        </div>
        {fieldErrors.displayName && <p id="signup-display-name-error" className="oa-auth-field-error" role="alert">{fieldErrors.displayName}</p>}
      </div>

      <div className="oa-auth-field" data-invalid={fieldErrors.email ? "true" : undefined}>
        <label htmlFor="signup-email">
          Email
        </label>
        <div className="oa-auth-input-shell">
          <Mail className="oa-auth-input-icon" aria-hidden="true" />
          <input
            id="signup-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.currentTarget.value)}
            placeholder="jane@example.com"
            className="oa-auth-input"
            autoComplete="email"
            aria-required="true"
            aria-describedby={fieldErrors.email ? "signup-email-error" : undefined}
            aria-invalid={fieldErrors.email ? "true" : undefined}
          />
        </div>
        {fieldErrors.email && <p id="signup-email-error" className="oa-auth-field-error" role="alert">{fieldErrors.email}</p>}
      </div>

      <div className="oa-auth-field" data-invalid={fieldErrors.password ? "true" : undefined}>
        <label htmlFor="signup-password">
          Password
        </label>
        <div className="oa-auth-input-shell">
          <Lock className="oa-auth-input-icon" aria-hidden="true" />
          <input
            id="signup-password"
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.currentTarget.value)}
            placeholder="At least 8 characters"
            className="oa-auth-input has-action"
            autoComplete="new-password"
            aria-required="true"
            aria-describedby={fieldErrors.password ? "signup-password-error" : undefined}
            aria-invalid={fieldErrors.password ? "true" : undefined}
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="oa-auth-password-toggle"
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
          </button>
        </div>
        {fieldErrors.password && <p id="signup-password-error" className="oa-auth-field-error" role="alert">{fieldErrors.password}</p>}
      </div>

      {error && (
        <div className="oa-auth-error" role="alert">
          {error}
        </div>
      )}

      <button
        className="oa-auth-submit"
        disabled={isLoading}
        type="submit"
      >
        {isLoading ? "Creating account..." : "Create account"}
      </button>

      <p className="oa-auth-switch-copy">
        Already have an account?{" "}
        <Link to="/login" className="oa-auth-switch-link">
          Log in
        </Link>
      </p>
    </form>
  );
}
