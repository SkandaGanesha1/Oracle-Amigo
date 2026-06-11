import { Activity, Boxes, Component, Cpu, FileLock2, History, LayoutDashboard, Network, ScrollText, ShieldAlert, ShieldCheck, Stamp, Users2 } from "lucide-react";
import { useEffect, useState, type FC } from "react";

interface NavLink {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  end?: boolean;
}

const items: NavLink[] = [
  { to: "/", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/users", label: "Users", icon: Users2 },
  { to: "/devices", label: "Devices", icon: Cpu },
  { to: "/instances", label: "Agent Instances", icon: Boxes },
  { to: "/presence", label: "Presence", icon: Activity },
  { to: "/tasks", label: "Tasks", icon: ScrollText },
  { to: "/transfers", label: "Transfers", icon: FileLock2 },
  { to: "/approvals", label: "Approvals", icon: Stamp },
  { to: "/audit", label: "Audit", icon: History },
  { to: "/policy", label: "Policy Rules", icon: ShieldCheck },
  { to: "/security", label: "Security", icon: ShieldAlert },
  { to: "/components", label: "Component Lab", icon: Component }
];

function isActive(itemTo: string, hash: string, end?: boolean): boolean {
  const norm = hash.startsWith("#") ? hash.slice(1) : hash;
  const path = norm || "/";
  if (end) return path === itemTo;
  if (itemTo === "/") return path === "/";
  return path === itemTo || path.startsWith(`${itemTo}/`);
}

export const Sidebar: FC = () => {
  const [hash, setHash] = useState<string>(() => window.location.hash || "#/");

  useEffect(() => {
    const onChange = () => setHash(window.location.hash || "#/");
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  return (
    <aside className="flex h-full w-56 shrink-0 flex-col gap-1 border-r border-white/10 bg-[#070708]/80 p-3">
      <div className="mb-2 flex items-center gap-2 px-2 py-1">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-emerald-400/15">
          <Network className="h-4 w-4 text-emerald-300" />
        </div>
        <div className="leading-tight">
          <p className="text-xs font-semibold text-white">Oracle Amigo</p>
          <p className="text-[10px] uppercase tracking-wider text-white/40">Admin Portal</p>
        </div>
      </div>
      <nav className="flex flex-1 flex-col gap-0.5">
        {items.map((item) => (
          <a
            key={item.to}
            href={`#${item.to}`}
            className={`group flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs transition ${
              isActive(item.to, hash, item.end)
                ? "bg-emerald-400/10 text-emerald-200"
                : "text-white/65 hover:bg-white/5 hover:text-white"
            }`}
          >
            <item.icon className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{item.label}</span>
          </a>
        ))}
      </nav>
      <div className="rounded-md border border-white/5 bg-white/[0.02] p-2 text-[10px] leading-relaxed text-white/40">
        <p>Monitoring and revocation.</p>
        <p className="mt-1">Session is HttpOnly + SameSite=Strict.</p>
      </div>
    </aside>
  );
};
