import { LoaderCircle, LogOut } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useLogout } from "../../hooks/queries";

type AuthMode = "signup" | "login";

interface MiniNavbarProps {
  mode?: AuthMode;
  onModeChange?: (mode: AuthMode) => void;
  showLogout?: boolean;
}

export function MiniNavbar({ mode, onModeChange, showLogout = false }: MiniNavbarProps) {
  const navigate = useNavigate();
  const logout = useLogout();

  async function handleLogout() {
    try {
      await logout.mutateAsync();
      navigate("/login", { replace: true });
    } catch {
      // The mutation owns user-facing error reporting.
    }
  }

  const LogoutIcon = logout.isPending ? LoaderCircle : LogOut;

  return (
    <header className="oa-auth-nav" aria-label={showLogout ? "Enrollment" : "Authentication"}>
      <div className="oa-auth-logo" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </div>
      <h2 className="oa-auth-brand">Oracle Amigo</h2>
      {showLogout ? (
        <div className="oa-auth-nav-actions oa-auth-nav-actions-single">
          <button
            type="button"
            className="oa-auth-nav-logout"
            onClick={() => void handleLogout()}
            disabled={logout.isPending}
            aria-label="Log out"
          >
            <LogoutIcon className={logout.isPending ? "animate-spin" : ""} aria-hidden="true" />
            <span>Log out</span>
          </button>
        </div>
      ) : (
        <div className="oa-auth-nav-actions" role="tablist" aria-label="Auth mode">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "login"}
            className={mode === "login" ? "is-active" : ""}
            onClick={() => onModeChange?.("login")}
          >
            Log in
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "signup"}
            className={mode === "signup" ? "is-active" : ""}
            onClick={() => onModeChange?.("signup")}
          >
            Sign up
          </button>
        </div>
      )}
    </header>
  );
}
