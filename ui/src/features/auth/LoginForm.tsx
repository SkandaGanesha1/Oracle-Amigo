import { useState } from "react";
import { Link } from "react-router-dom";
import { Eye, EyeOff, Mail, Lock } from "lucide-react";
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
    <form onSubmit={handleSubmit} className="oa-auth-form" noValidate>
      <div className="oa-auth-field" data-invalid={fieldErrors.email ? "true" : undefined}>
        <label htmlFor="login-email">
          Email
        </label>
        <div className="oa-auth-input-shell">
          <Mail className="oa-auth-input-icon" aria-hidden="true" />
          <input
            id="login-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.currentTarget.value)}
            placeholder="jane@example.com"
            className="oa-auth-input"
            autoComplete="email"
            aria-required="true"
            aria-describedby={fieldErrors.email ? "login-email-error" : undefined}
            aria-invalid={fieldErrors.email ? "true" : undefined}
            autoFocus
          />
        </div>
        {fieldErrors.email && <p id="login-email-error" className="oa-auth-field-error" role="alert">{fieldErrors.email}</p>}
      </div>

      <div className="oa-auth-field" data-invalid={fieldErrors.password ? "true" : undefined}>
        <label htmlFor="login-password">
          Password
        </label>
        <div className="oa-auth-input-shell">
          <Lock className="oa-auth-input-icon" aria-hidden="true" />
          <input
            id="login-password"
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.currentTarget.value)}
            placeholder="Enter your password"
            className="oa-auth-input has-action"
            autoComplete="current-password"
            aria-required="true"
            aria-describedby={fieldErrors.password ? "login-password-error" : undefined}
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
        {fieldErrors.password && <p id="login-password-error" className="oa-auth-field-error" role="alert">{fieldErrors.password}</p>}
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
        {isLoading ? "Signing in..." : "Log in"}
      </button>

      <p className="oa-auth-switch-copy">
        Don't have an account?{" "}
        <Link to="/signup" className="oa-auth-switch-link">
          Sign up
        </Link>
      </p>
    </form>
  );
}
