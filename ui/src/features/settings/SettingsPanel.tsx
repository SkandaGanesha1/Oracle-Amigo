import { useState } from "react";
import {
  useAgentDiagnostics,
  useCloudStatus,
  useCreatePolicyRule,
  useDeletePolicyRule,
  useEvaluateCommandPolicy,
  useEvaluatePolicyRule,
  useNotifications,
  usePolicyRules,
  usePolicySummary
} from "../../hooks/queries";
import { useDensityPreference } from "../../lib/uiPreferences";
import { setPrivacyMode } from "../../lib/usePrivacyMode";
import { useTheme, Theme } from "../../components/primitives/ThemeProvider";
import {
  Settings, Shield, Bell, Bot, Lock, User, HardDrive, Palette, Ban, Wifi, Globe, Monitor, Key, AlertCircle, Terminal, Moon, Sun, Contrast,
} from "lucide-react";

const sections = [
  { id: "account", label: "Account", icon: User },
  { id: "security", label: "Security", icon: Shield },
  { id: "privacy", label: "Privacy", icon: Lock },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "policy-rules", label: "Policy Rules", icon: Shield },
  { id: "autonomy", label: "Agent Autonomy", icon: Bot },
  { id: "file-access", label: "File Access", icon: HardDrive },
  { id: "blocked", label: "Blocked", icon: Ban },
  { id: "devices", label: "Device Management", icon: Monitor },
  { id: "theme", label: "Theme", icon: Palette },
  { id: "advanced", label: "Advanced", icon: Settings },
] as const;

function Toggle({ enabled, onChange, label }: { enabled: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex min-h-[48px] cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 hover:bg-oa-surface transition-colors">
      <span className="text-xs text-oa-text">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        onClick={() => onChange(!enabled)}
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue focus-visible:ring-offset-2 ${enabled ? "bg-oa-blue" : "bg-oa-surface-2"}`}
      >
        <span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${enabled ? "translate-x-4" : ""}`} />
      </button>
    </label>
  );
}

function SettingSection({ children, title, description }: { children: React.ReactNode; title: string; description?: string }) {
  return (
    <div className="space-y-2">
      <div>
        <h3 className="text-sm font-semibold text-oa-text">{title}</h3>
        {description && <p className="text-xs text-oa-text-muted">{description}</p>}
      </div>
      <div className="rounded-xl border border-oa-border bg-oa-surface overflow-hidden">
        {children}
      </div>
    </div>
  );
}

function NotificationEventsPanel() {
  const { data } = useNotifications();
  const events = data?.events ?? [];
  return (
    <SettingSection title="Recent Notification Events" description="In-app fallback events for approvals, transfers, policy decisions, and mission failures">
      <div className="divide-y divide-oa-border/50">
        {events.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-oa-text-muted">No notification events yet</div>
        ) : (
          events.slice(0, 8).map((event) => (
            <div key={event.id} className="px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-xs font-medium text-oa-text">{event.title}</p>
                <span className="shrink-0 text-[9px] text-oa-text-disabled">{new Date(event.createdAt).toLocaleString()}</span>
              </div>
              <p className="mt-1 line-clamp-2 text-[10px] text-oa-text-muted">{event.body}</p>
              <p className="mt-1 text-[9px] uppercase tracking-wider text-oa-text-disabled">{event.severity} / {event.eventType}</p>
            </div>
          ))
        )}
      </div>
    </SettingSection>
  );
}

function PolicyRulesPanel() {
  const { data } = usePolicyRules();
  const createRule = useCreatePolicyRule();
  const deleteRule = useDeletePolicyRule();
  const evaluate = useEvaluatePolicyRule();
  const [name, setName] = useState("Block high-risk executable transfer");
  const [extension, setExtension] = useState(".exe");
  const [sensitivity, setSensitivity] = useState("high");
  const [action, setAction] = useState<"allow" | "require_approval" | "deny">("deny");

  const rules = data?.rules ?? [];

  return (
    <div className="space-y-4">
      <SettingSection title="Policy Rule Builder" description="Rules are enforced during approvals, transfer initiation, command evaluation, and vault export checks where those backend paths call the policy engine.">
        <div className="space-y-3 p-3">
          <div className="grid gap-2 md:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-[10px] text-oa-text-muted">Rule name</span>
              <input value={name} onChange={(event) => setName(event.target.value)} className="h-10 w-full rounded-lg border border-oa-border bg-oa-bg px-3 text-xs text-oa-text outline-none focus:border-oa-blue" />
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] text-oa-text-muted">File extension</span>
              <input value={extension} onChange={(event) => setExtension(event.target.value)} className="h-10 w-full rounded-lg border border-oa-border bg-oa-bg px-3 text-xs text-oa-text outline-none focus:border-oa-blue" />
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] text-oa-text-muted">Sensitivity</span>
              <select value={sensitivity} onChange={(event) => setSensitivity(event.target.value)} className="h-10 w-full rounded-lg border border-oa-border bg-oa-bg px-3 text-xs text-oa-text outline-none focus:border-oa-blue">
                <option value="any">Any</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] text-oa-text-muted">Default action</span>
              <select value={action} onChange={(event) => setAction(event.target.value as typeof action)} className="h-10 w-full rounded-lg border border-oa-border bg-oa-bg px-3 text-xs text-oa-text outline-none focus:border-oa-blue">
                <option value="allow">Allow</option>
                <option value="require_approval">Require approval</option>
                <option value="deny">Deny</option>
              </select>
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => createRule.mutate({
                name,
                description: "Created from local settings",
                enabled: true,
                role: "user",
                sensitivity,
                fileExtension: extension,
                transferDirection: "outbound",
                action,
                reason: `${action} ${extension || "matching"} transfers`,
                priority: 100
              })}
              disabled={!name.trim() || createRule.isPending}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-oa-blue px-3 text-xs font-medium text-white disabled:opacity-50"
            >
              <Shield className="h-3.5 w-3.5" />
              Save rule
            </button>
            <button
              type="button"
              onClick={() => evaluate.mutate({ sensitivity, fileExtension: extension, transferDirection: "outbound", fileSizeBytes: 1024 })}
              disabled={evaluate.isPending}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-oa-border bg-oa-surface-2 px-3 text-xs text-oa-text-muted disabled:opacity-50"
            >
              <Terminal className="h-3.5 w-3.5" />
              Test rule
            </button>
            <a href="/policy/export.csv" className="inline-flex min-h-[40px] items-center rounded-lg border border-oa-border bg-oa-surface-2 px-3 text-xs text-oa-text-muted">
              Export CSV
            </a>
          </div>
          {evaluate.data?.evaluation && (
            <div className={`rounded-lg border p-3 text-xs ${
              evaluate.data.evaluation.action === "deny" ? "border-oa-red/30 bg-oa-red/10 text-oa-red" :
              evaluate.data.evaluation.action === "allow" ? "border-oa-green/30 bg-oa-green/10 text-oa-green" :
              "border-oa-amber/30 bg-oa-amber/10 text-oa-amber"
            }`}>
              <p className="font-semibold">{evaluate.data.evaluation.action}</p>
              <p className="mt-1">{evaluate.data.evaluation.reason}</p>
            </div>
          )}
        </div>
      </SettingSection>

      <SettingSection title="Active Rules" description="Rules are ordered by priority; unsupported actions are hidden rather than shown as fake controls.">
        <div className="divide-y divide-oa-border/50">
          {rules.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-oa-text-muted">No policy rules yet</div>
          ) : (
            rules.map((rule) => (
              <div key={rule.id} className="flex items-start gap-3 px-3 py-2.5">
                <Shield className={`mt-0.5 h-4 w-4 shrink-0 ${rule.action === "deny" ? "text-oa-red" : rule.action === "allow" ? "text-oa-green" : "text-oa-amber"}`} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-oa-text">{rule.name}</p>
                  <p className="mt-0.5 text-[10px] text-oa-text-muted">
                    {rule.action} / {rule.sensitivity || "any"} / {rule.fileExtension || "any extension"} / priority {rule.priority}
                  </p>
                  <p className="mt-0.5 text-[10px] text-oa-text-disabled">{rule.reason}</p>
                </div>
                <button
                  type="button"
                  onClick={() => deleteRule.mutate(rule.id)}
                  className="rounded-lg border border-oa-red/20 bg-oa-red/5 px-2 py-1 text-[10px] text-oa-red"
                >
                  Delete
                </button>
              </div>
            ))
          )}
        </div>
      </SettingSection>
    </div>
  );
}

export function SettingsPanel() {
  const { data: cloudData, isLoading: cloudLoading } = useCloudStatus();
  const { data: diagData } = useAgentDiagnostics();
  const { data: policySummary } = usePolicySummary();
  const evaluatePolicy = useEvaluateCommandPolicy();
  const [activeSection, setActiveSection] = useState("account");
  const { density, setDensity } = useDensityPreference();
  const { theme, setTheme } = useTheme();
  const [commandInput, setCommandInput] = useState("npm test");

  const cloud = cloudData?.cloud;
  const relayMode = cloudData?.relayMode;
  const health = diagData?.health;

  const [settings, setSettings] = useState({
    privacyShowOnline: true,
    privacyShareDiagnostics: false,
    notificationsEnabled: true,
    notifyApprovals: true,
    notifyTransfers: true,
    notifyErrors: true,
    autoApproveLowRisk: false,
    autonomyAutoRetry: true,
    autonomyConfirmFileAccess: true,
    autonomyConfirmExternal: true,
    autonomyMaxRetries: 3,
    fileAccessConfirmBeforeSend: true,
    fileAccessShowPreview: true,
    fileAccessAutoVerify: true,
    themeDark: true,
    privacySafeMode: false,
    showDevDiagnostics: false,
  });

  if (cloudLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-xs text-oa-text-muted">Loading settings...</p>
      </div>
    );
  }

  const ActiveIcon = sections.find((s) => s.id === activeSection)?.icon ?? Settings;

  return (
    <div className="flex flex-1 gap-6 p-6 max-w-5xl">
      <nav className="flex w-48 shrink-0 flex-col gap-0.5" aria-label="Settings sections">
        {sections.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setActiveSection(id)}
            className={`flex min-h-[48px] items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue ${
              activeSection === id
                ? "bg-oa-blue/20 text-oa-blue"
                : "text-oa-text-muted hover:bg-oa-surface hover:text-oa-text"
            }`}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </button>
        ))}
      </nav>

      <div className="flex-1 space-y-5 overflow-y-auto pb-12">
        <div className="flex items-center gap-2.5 border-b border-oa-border pb-3">
          <ActiveIcon className="h-5 w-5 text-oa-blue" />
          <h2 className="text-base font-semibold text-oa-text">
            {sections.find((s) => s.id === activeSection)?.label}
          </h2>
        </div>

        {activeSection === "account" && (
          <div className="space-y-4">
            <SettingSection title="Profile" description="Your account information across the control plane">
              <div className="divide-y divide-oa-border/50">
                <div className="flex items-center justify-between px-3 py-2.5">
                  <span className="text-xs text-oa-text-muted">Display Name</span>
                  <span className="text-xs text-oa-text font-medium">{cloud?.displayName ?? "—"}</span>
                </div>
                <div className="flex items-center justify-between px-3 py-2.5">
                  <span className="text-xs text-oa-text-muted">Email</span>
                  <span className="text-xs text-oa-text font-medium">{cloud?.userEmail ?? "—"}</span>
                </div>
                <div className="flex items-center justify-between px-3 py-2.5">
                  <span className="text-xs text-oa-text-muted">User ID</span>
                  <span className="text-xs font-mono text-oa-text-muted">{cloud?.userId ?? "—"}</span>
                </div>
                <div className="flex items-center justify-between px-3 py-2.5">
                  <span className="text-xs text-oa-text-muted">Status</span>
                  <span className={`text-xs font-medium ${cloud?.status === "enrolled" ? "text-oa-green" : "text-oa-amber"}`}>
                    {cloud?.status ?? "disconnected"}
                  </span>
                </div>
              </div>
            </SettingSection>
            <SettingSection title="Connection" description="Control plane and relay configuration">
              <div className="divide-y divide-oa-border/50">
                <div className="flex items-center justify-between px-3 py-2.5">
                  <span className="text-xs text-oa-text-muted">Control Plane</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-oa-text font-mono truncate max-w-[200px]">{cloud?.controlPlaneUrl ?? "—"}</span>
                    {cloudData?.controlPlane?.reachable && <Wifi className="h-3 w-3 text-oa-green" />}
                  </div>
                </div>
                <div className="flex items-center justify-between px-3 py-2.5">
                  <span className="text-xs text-oa-text-muted">Relay Mode</span>
                  <span className="text-xs text-oa-text font-mono">{relayMode ?? "—"}</span>
                </div>
                <div className="flex items-center justify-between px-3 py-2.5">
                  <span className="text-xs text-oa-text-muted">Agent Instance ID</span>
                  <span className="text-xs font-mono text-oa-text-muted">{cloud?.agentInstanceId?.slice(0, 20) ?? "—"}...</span>
                </div>
                <div className="flex items-center justify-between px-3 py-2.5">
                  <span className="text-xs text-oa-text-muted">Device ID</span>
                  <span className="text-xs font-mono text-oa-text-muted">{cloud?.deviceId?.slice(0, 20) ?? "—"}...</span>
                </div>
              </div>
            </SettingSection>
          </div>
        )}

        {activeSection === "security" && (
          <div className="space-y-4">
            <SettingSection title="Session" description="Current session and authentication status">
              <div className="divide-y divide-oa-border/50">
                <div className="flex items-center justify-between px-3 py-2.5">
                  <span className="text-xs text-oa-text-muted">User Token</span>
                  <span className={`text-xs font-medium ${cloud?.hasUserAccessToken ? "text-oa-green" : "text-oa-text-muted"}`}>
                    {cloud?.hasUserAccessToken ? "Active" : "None"}
                  </span>
                </div>
                <div className="flex items-center justify-between px-3 py-2.5">
                  <span className="text-xs text-oa-text-muted">Device Token</span>
                  <span className={`text-xs font-medium ${cloud?.hasDeviceAccessToken ? "text-oa-green" : "text-oa-text-muted"}`}>
                    {cloud?.hasDeviceAccessToken ? "Active" : "None"}
                  </span>
                </div>
                <div className="flex items-center justify-between px-3 py-2.5">
                  <span className="text-xs text-oa-text-muted">Refresh Token</span>
                  <span className={`text-xs font-medium ${cloud?.hasRefreshToken ? "text-oa-green" : "text-oa-text-muted"}`}>
                    {cloud?.hasRefreshToken ? "Active" : "None"}
                  </span>
                </div>
              </div>
            </SettingSection>
            <SettingSection title="Encryption" description="End-to-end encryption status">
              <div className="flex items-center gap-3 px-3 py-2.5">
                <Key className="h-4 w-4 text-oa-blue" />
                <div>
                  <p className="text-xs text-oa-text">AES-128-GCM session encryption</p>
                  <p className="text-[10px] text-oa-text-muted">ECDHE key exchange via DID:WBA identity</p>
                </div>
              </div>
            </SettingSection>
          </div>
        )}

        {activeSection === "privacy" && (
          <SettingSection title="Privacy Settings" description="Control your visibility and data sharing">
            <div className="divide-y divide-oa-border/50">
              <Toggle enabled={settings.privacyShowOnline} onChange={(v) => setSettings((s) => ({ ...s, privacyShowOnline: v }))} label="Show online status" />
              <Toggle enabled={settings.privacyShareDiagnostics} onChange={(v) => setSettings((s) => ({ ...s, privacyShareDiagnostics: v }))} label="Share anonymous diagnostics" />
              <Toggle enabled={settings.privacySafeMode} onChange={(v) => { setSettings((s) => ({ ...s, privacySafeMode: v })); setPrivacyMode(v); }} label="Privacy-safe mode (mask filenames)" />
            </div>
          </SettingSection>
        )}

        {activeSection === "notifications" && (
          <div className="space-y-4">
            <SettingSection title="Notification Preferences" description="Choose which events trigger notifications">
              <div className="divide-y divide-oa-border/50">
                <Toggle enabled={settings.notificationsEnabled} onChange={(v) => setSettings((s) => ({ ...s, notificationsEnabled: v }))} label="Enable notifications" />
                <Toggle enabled={settings.notifyApprovals} onChange={(v) => setSettings((s) => ({ ...s, notifyApprovals: v }))} label="Approval requests" />
                <Toggle enabled={settings.notifyTransfers} onChange={(v) => setSettings((s) => ({ ...s, notifyTransfers: v }))} label="File transfers" />
                <Toggle enabled={settings.notifyErrors} onChange={(v) => setSettings((s) => ({ ...s, notifyErrors: v }))} label="Errors and failures" />
              </div>
            </SettingSection>
            <NotificationEventsPanel />
          </div>
        )}

        {activeSection === "policy-rules" && <PolicyRulesPanel />}

        {activeSection === "autonomy" && (
          <SettingSection title="Agent Autonomy" description="Configure how much autonomy your agent has">
            <div className="divide-y divide-oa-border/50">
              <Toggle enabled={settings.autoApproveLowRisk} onChange={(v) => setSettings((s) => ({ ...s, autoApproveLowRisk: v }))} label="Auto-approve low-risk requests" />
              <Toggle enabled={settings.autonomyAutoRetry} onChange={(v) => setSettings((s) => ({ ...s, autonomyAutoRetry: v }))} label="Auto-retry on transient failures" />
              <Toggle enabled={settings.autonomyConfirmFileAccess} onChange={(v) => setSettings((s) => ({ ...s, autonomyConfirmFileAccess: v }))} label="Confirm before file access" />
              <Toggle enabled={settings.autonomyConfirmExternal} onChange={(v) => setSettings((s) => ({ ...s, autonomyConfirmExternal: v }))} label="Confirm before external requests" />
              <div className="flex items-center justify-between px-3 py-2.5">
                <span className="text-xs text-oa-text-muted">Max retries</span>
                <div className="flex items-center gap-2">
                  {[1, 2, 3, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setSettings((s) => ({ ...s, autonomyMaxRetries: n }))}
                      className={`min-h-[48px] min-w-[48px] rounded-lg text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue ${
                        settings.autonomyMaxRetries === n ? "bg-oa-blue/20 text-oa-blue" : "text-oa-text-muted hover:bg-oa-surface-2"
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </SettingSection>
        )}

        {activeSection === "file-access" && (
          <SettingSection title="File Access Policies" description="Control how agents access and share files">
            <div className="divide-y divide-oa-border/50">
              <Toggle enabled={settings.fileAccessConfirmBeforeSend} onChange={(v) => setSettings((s) => ({ ...s, fileAccessConfirmBeforeSend: v }))} label="Confirm before sending files" />
              <Toggle enabled={settings.fileAccessShowPreview} onChange={(v) => setSettings((s) => ({ ...s, fileAccessShowPreview: v }))} label="Show file previews" />
              <Toggle enabled={settings.fileAccessAutoVerify} onChange={(v) => setSettings((s) => ({ ...s, fileAccessAutoVerify: v }))} label="Auto-verify file hashes" />
            </div>
          </SettingSection>
        )}

        {activeSection === "blocked" && (
          <SettingSection title="Blocked Agents & Users" description="Agents and users you have blocked">
            <div className="flex flex-col items-center py-6 text-center">
              <Ban className="h-8 w-8 text-oa-text-disabled" />
              <p className="mt-2 text-xs text-oa-text-muted">No blocked agents or users</p>
              <p className="text-[10px] text-oa-text-disabled">Blocked contacts will appear here</p>
            </div>
          </SettingSection>
        )}

        {activeSection === "devices" && (
          <SettingSection title="Device Management" description="Manage your enrolled devices">
            <div className="divide-y divide-oa-border/50">
              <div className="flex items-center justify-between px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <Monitor className="h-4 w-4 text-oa-text-muted" />
                  <div>
                    <p className="text-xs text-oa-text">Current Device</p>
                    <p className="text-[10px] text-oa-text-muted font-mono">{cloud?.deviceId ?? "—"}</p>
                  </div>
                </div>
                <span className="rounded-full bg-oa-green/10 px-2 py-0.5 text-[9px] font-medium text-oa-green">Active</span>
              </div>
            </div>
          </SettingSection>
        )}

        {activeSection === "theme" && (
          <div className="space-y-4">
            <SettingSection title="Appearance" description="Customize the look and feel">
              <div className="divide-y divide-oa-border/50">
                <div className="flex items-center justify-between px-3 py-2.5">
                  <span className="text-xs text-oa-text">Theme</span>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => setTheme("auto")}
                      className={`flex min-h-[48px] items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue ${
                        theme === "auto" ? "bg-oa-blue/20 text-oa-blue" : "text-oa-text-muted hover:bg-oa-surface-2"
                      }`}
                      title="Automatically match system preference"
                    >
                      <Monitor className="h-3.5 w-3.5" />
                      Auto
                    </button>
                    <button
                      type="button"
                      onClick={() => setTheme("dark")}
                      className={`flex min-h-[48px] items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue ${
                        theme === "dark" ? "bg-oa-blue/20 text-oa-blue" : "text-oa-text-muted hover:bg-oa-surface-2"
                      }`}
                      title="Dark theme"
                    >
                      <Moon className="h-3.5 w-3.5" />
                      Dark
                    </button>
                    <button
                      type="button"
                      onClick={() => setTheme("light")}
                      className={`flex min-h-[48px] items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue ${
                        theme === "light" ? "bg-oa-blue/20 text-oa-blue" : "text-oa-text-muted hover:bg-oa-surface-2"
                      }`}
                      title="Light theme"
                    >
                      <Sun className="h-3.5 w-3.5" />
                      Light
                    </button>
                    <button
                      type="button"
                      onClick={() => setTheme("high-contrast")}
                      className={`flex min-h-[48px] items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue ${
                        theme === "high-contrast" ? "bg-oa-blue/20 text-oa-blue" : "text-oa-text-muted hover:bg-oa-surface-2"
                      }`}
                      title="High contrast mode for better visibility"
                    >
                      <Contrast className="h-3.5 w-3.5" />
                      High Contrast
                    </button>
                  </div>
                </div>
                <Toggle enabled={density === "compact"} onChange={(v) => setDensity(v ? "compact" : "comfortable")} label="Compact density" />
                <div className="flex items-center justify-between px-3 py-2.5">
                  <span className="text-xs text-oa-text-muted">Current density</span>
                  <span className="rounded-full bg-oa-blue/10 px-2 py-0.5 text-[10px] font-medium text-oa-blue">{density}</span>
                </div>
              </div>
            </SettingSection>
          </div>
        )}

        {activeSection === "advanced" && (
          <div className="space-y-4">
            <SettingSection title="Command Policy Simulator" description="Dry-run local shell commands against the policy engine without executing them.">
              <div className="space-y-3 p-3">
                <div className="grid gap-2 md:grid-cols-3">
                  <div className="rounded-lg border border-oa-border bg-oa-bg-elevated p-3">
                    <p className="text-[10px] uppercase tracking-wider text-oa-text-muted">Max length</p>
                    <p className="mt-1 text-sm font-semibold text-oa-text">{policySummary?.command.maxCommandLength ?? "-"}</p>
                  </div>
                  <div className="rounded-lg border border-oa-border bg-oa-bg-elevated p-3">
                    <p className="text-[10px] uppercase tracking-wider text-oa-text-muted">Timeout cap</p>
                    <p className="mt-1 text-sm font-semibold text-oa-text">{policySummary?.command.maxTimeoutMs ?? "-"} ms</p>
                  </div>
                  <div className="rounded-lg border border-oa-border bg-oa-bg-elevated p-3">
                    <p className="text-[10px] uppercase tracking-wider text-oa-text-muted">Scoped secrets</p>
                    <p className="mt-1 text-sm font-semibold text-oa-text">{policySummary?.secrets.configuredSecretCount ?? 0}</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(policySummary?.command.enforcedRules ?? []).map((rule) => (
                    <span key={rule} className="rounded-full border border-oa-border bg-oa-bg-elevated px-2 py-1 text-[10px] text-oa-text-muted">
                      {rule}
                    </span>
                  ))}
                </div>
                <textarea
                  value={commandInput}
                  onChange={(event) => setCommandInput(event.target.value)}
                  rows={4}
                  className="w-full resize-none rounded-lg border border-oa-border bg-oa-bg p-3 text-xs font-mono text-oa-text outline-none focus:border-oa-blue"
                />
                <button
                  type="button"
                  onClick={() => evaluatePolicy.mutate({ command: commandInput })}
                  disabled={!commandInput.trim() || evaluatePolicy.isPending}
                  className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-oa-border bg-oa-blue/10 px-3 text-xs text-oa-blue disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Terminal className="h-3.5 w-3.5" />
                  Evaluate
                </button>
                {evaluatePolicy.data && (
                  <div className={`rounded-lg border p-3 text-xs ${evaluatePolicy.data.allowed ? "border-oa-green/30 bg-oa-green/10 text-oa-green" : "border-oa-red/30 bg-oa-red/10 text-oa-red"}`}>
                    <p className="font-semibold">{evaluatePolicy.data.allowed ? "Allowed" : "Blocked"} - {evaluatePolicy.data.classification}</p>
                    <p className="mt-1">{evaluatePolicy.data.reason}</p>
                    <p className="mt-2 font-mono text-[10px] opacity-80">Timeout cap: {evaluatePolicy.data.cappedTimeoutMs} ms</p>
                  </div>
                )}
              </div>
            </SettingSection>

            <SettingSection title="Developer Diagnostics" description="Low-level system information. Only enable when debugging issues with support.">
              <div className="divide-y divide-oa-border/50">
                <div className="px-3 py-2.5">
                  <p className="mb-2 text-xs text-oa-amber flex items-center gap-1.5">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                    This displays internal identifiers, URLs, and system internals not intended for general use.
                  </p>
                  <label className="flex min-h-[48px] cursor-pointer items-center justify-between gap-3 rounded-lg border border-oa-red/20 bg-oa-red/5 px-3 py-2">
                    <span className="text-xs font-medium text-oa-red">Show developer diagnostics</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={settings.showDevDiagnostics}
                      onClick={() => setSettings((s) => ({ ...s, showDevDiagnostics: !s.showDevDiagnostics }))}
                      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue focus-visible:ring-offset-2 ${settings.showDevDiagnostics ? "bg-oa-red" : "bg-oa-surface-2"}`}
                    >
                      <span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${settings.showDevDiagnostics ? "translate-x-4" : ""}`} />
                    </button>
                  </label>
                </div>
                {settings.showDevDiagnostics && (
                  <>
                    <div className="flex items-center justify-between px-3 py-2.5">
                      <span className="text-xs text-oa-text-muted">Backend Status</span>
                      <span className="text-xs font-medium text-oa-green">{health?.status ?? "—"}</span>
                    </div>
                    <div className="flex items-center justify-between px-3 py-2.5">
                      <span className="text-xs text-oa-text-muted">Dry Run Mode</span>
                      <span className="text-xs font-medium">{health?.dryRun ? "Enabled" : "Disabled"}</span>
                    </div>
                    <div className="flex items-center justify-between px-3 py-2.5">
                      <span className="text-xs text-oa-text-muted">User Token</span>
                      <span className={`text-xs font-medium ${cloud?.hasUserAccessToken ? "text-oa-green" : "text-oa-text-muted"}`}>
                        {cloud?.hasUserAccessToken ? "Active" : "None"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between px-3 py-2.5">
                      <span className="text-xs text-oa-text-muted">Device Token</span>
                      <span className={`text-xs font-medium ${cloud?.hasDeviceAccessToken ? "text-oa-green" : "text-oa-text-muted"}`}>
                        {cloud?.hasDeviceAccessToken ? "Active" : "None"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between px-3 py-2.5">
                      <span className="text-xs text-oa-text-muted">Control Plane</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-oa-text font-mono truncate max-w-[200px]">{cloud?.controlPlaneUrl ?? "—"}</span>
                        {cloudData?.controlPlane?.reachable && <Wifi className="h-3 w-3 text-oa-green" />}
                      </div>
                    </div>
                    <div className="flex items-center justify-between px-3 py-2.5">
                      <span className="text-xs text-oa-text-muted">Relay Mode</span>
                      <span className="text-xs text-oa-text font-mono">{relayMode ?? "—"}</span>
                    </div>
                    <div className="flex items-center justify-between px-3 py-2.5">
                      <span className="text-xs text-oa-text-muted">Agent Instance ID</span>
                      <span className="text-xs font-mono text-oa-text-muted">{cloud?.agentInstanceId ?? "—"}</span>
                    </div>
                    <div className="flex items-center justify-between px-3 py-2.5">
                      <span className="text-xs text-oa-text-muted">Device ID</span>
                      <span className="text-xs font-mono text-oa-text-muted">{cloud?.deviceId ?? "—"}</span>
                    </div>
                  </>
                )}
              </div>
            </SettingSection>
          </div>
        )}
      </div>
    </div>
  );
}
