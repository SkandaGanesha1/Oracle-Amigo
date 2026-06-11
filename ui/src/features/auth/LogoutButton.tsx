import { useNavigate } from "react-router-dom";
import { LoaderCircle, LogOut } from "lucide-react";
import { useLogout } from "../../hooks/queries";

interface LogoutButtonProps {
  compact?: boolean;
}

export function LogoutButton({ compact = false }: LogoutButtonProps) {
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

  const Icon = logout.isPending ? LoaderCircle : LogOut;

  return (
    <button
      type="button"
      onClick={() => void handleLogout()}
      disabled={logout.isPending}
      aria-label="Log out"
      title="Log out"
      className="group inline-flex min-h-[36px] items-center gap-2 rounded-lg border border-oa-border bg-oa-surface/60 px-2.5 py-1.5 text-xs font-medium text-oa-text-muted transition-colors hover:border-oa-red/40 hover:bg-oa-red/10 hover:text-oa-red focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-red focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <Icon className={`h-3.5 w-3.5 ${logout.isPending ? "animate-spin" : ""}`} />
      {!compact && <span>Log out</span>}
    </button>
  );
}
