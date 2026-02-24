import { useState, useEffect } from "react";
import { configApi, integrationsApi, ApiError } from "../lib/api.js";

type ConnectionStatus = "idle" | "testing" | "ok" | "error";

function PasswordInput({
  value,
  onChange,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        type={show ? "text" : "password"}
        className="input pr-10"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
      />
      <button
        type="button"
        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs"
        onClick={() => setShow((s) => !s)}
        disabled={disabled}
      >
        {show ? "hide" : "show"}
      </button>
    </div>
  );
}

function StatusDot({ status, error }: { status: ConnectionStatus; error?: string }) {
  if (status === "idle") return null;
  if (status === "testing") return <span className="text-sm text-gray-500">Testing…</span>;
  if (status === "ok") return <span className="text-sm text-green-600">✓ Connected</span>;
  return <span className="text-sm text-red-600">✗ {error ?? "Failed"}</span>;
}

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-base font-semibold text-gray-900">{title}</h2>
      {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
    </div>
  );
}

function SaveButton({ saving, onClick }: { saving: boolean; onClick: () => void }) {
  return (
    <button className="btn-primary text-sm px-4" onClick={onClick} disabled={saving}>
      {saving ? "Saving…" : "Save"}
    </button>
  );
}

export default function Settings() {
  const [loadError, setLoadError] = useState<string | null>(null);

  // Preferences
  const [companyName, setCompanyName] = useState("");
  const [brandColor, setBrandColor] = useState("#2563EB");
  const [defaultTemplate, setDefaultTemplate] = useState("minimal");
  const [pageFooter, setPageFooter] = useState("");
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [prefsSuccess, setPrefsSuccess] = useState(false);
  const [prefsError, setPrefsError] = useState("");

  // AI
  const [aiModel, setAiModel] = useState("claude-sonnet-4-6");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [savingAi, setSavingAi] = useState(false);
  const [aiSuccess, setAiSuccess] = useState(false);
  const [aiError, setAiError] = useState("");

  // Linear
  const [linearPat, setLinearPat] = useState("");
  const [linearStatus, setLinearStatus] = useState<ConnectionStatus>("idle");
  const [linearError, setLinearError] = useState("");
  const [linearConfigured, setLinearConfigured] = useState(false);
  const [savingLinear, setSavingLinear] = useState(false);

  // GitHub
  const [githubPat, setGithubPat] = useState("");
  const [githubOwner, setGithubOwner] = useState("");
  const [githubBaseUrl, setGithubBaseUrl] = useState("");
  const [githubStatus, setGithubStatus] = useState<ConnectionStatus>("idle");
  const [githubError, setGithubError] = useState("");
  const [githubConfigured, setGithubConfigured] = useState(false);
  const [savingGithub, setSavingGithub] = useState(false);

  // Jira
  const [jiraPat, setJiraPat] = useState("");
  const [jiraBaseUrl, setJiraBaseUrl] = useState("");
  const [jiraEmail, setJiraEmail] = useState("");
  const [jiraApiType, setJiraApiType] = useState<"cloud" | "server">("cloud");
  const [jiraStatus, setJiraStatus] = useState<ConnectionStatus>("idle");
  const [jiraError, setJiraError] = useState("");
  const [jiraConfigured, setJiraConfigured] = useState(false);
  const [savingJira, setSavingJira] = useState(false);

  // GitLab
  const [gitlabPat, setGitlabPat] = useState("");
  const [gitlabBaseUrl, setGitlabBaseUrl] = useState("");
  const [gitlabStatus, setGitlabStatus] = useState<ConnectionStatus>("idle");
  const [gitlabError, setGitlabError] = useState("");
  const [gitlabConfigured, setGitlabConfigured] = useState(false);
  const [savingGitlab, setSavingGitlab] = useState(false);

  // Notion
  const [notionToken, setNotionToken] = useState("");
  const [notionStatus, setNotionStatus] = useState<ConnectionStatus>("idle");
  const [notionError, setNotionError] = useState("");
  const [notionConfigured, setNotionConfigured] = useState(false);
  const [savingNotion, setSavingNotion] = useState(false);

  // Load current config on mount
  useEffect(() => {
    configApi
      .get()
      .then((data) => {
        const { config } = data as {
          config: {
            ai: { model: string; configured: boolean };
            preferences: {
              companyName?: string;
              brandColor?: string;
              defaultTemplate: string;
              pageFooter?: string;
            };
            integrations: {
              linear: { configured: boolean };
              github: { configured: boolean; defaultOwner?: string; baseUrl?: string };
              jira: { configured: boolean; baseUrl?: string; email?: string; apiType?: "cloud" | "server" };
              gitlab: { configured: boolean; baseUrl?: string };
              notion: { configured: boolean };
            };
          };
        };

        setAiModel(config.ai.model);
        setCompanyName(config.preferences.companyName ?? "");
        setBrandColor(config.preferences.brandColor ?? "#2563EB");
        setDefaultTemplate(config.preferences.defaultTemplate);
        setPageFooter(config.preferences.pageFooter ?? "");

        setLinearConfigured(config.integrations.linear.configured);
        setGithubConfigured(config.integrations.github.configured);
        setGithubOwner(config.integrations.github.defaultOwner ?? "");
        setGithubBaseUrl(config.integrations.github.baseUrl ?? "");
        setJiraConfigured(config.integrations.jira.configured);
        setJiraBaseUrl(config.integrations.jira.baseUrl ?? "");
        setJiraEmail(config.integrations.jira.email ?? "");
        setJiraApiType(config.integrations.jira.apiType ?? "cloud");
        setGitlabConfigured(config.integrations.gitlab.configured);
        setGitlabBaseUrl(config.integrations.gitlab.baseUrl ?? "");
        setNotionConfigured(config.integrations.notion.configured);
      })
      .catch((err: unknown) => {
        setLoadError(err instanceof ApiError ? err.message : "Failed to load settings.");
      });
  }, []);

  // ----------------------------------------------------------------
  // Save handlers
  // ----------------------------------------------------------------
  async function savePreferences() {
    setSavingPrefs(true);
    setPrefsError("");
    setPrefsSuccess(false);
    try {
      await configApi.update({
        preferences: {
          companyName: companyName || undefined,
          brandColor,
          defaultTemplate,
          pageFooter: pageFooter || undefined,
        },
      });
      setPrefsSuccess(true);
      setTimeout(() => setPrefsSuccess(false), 2500);
    } catch (err: unknown) {
      setPrefsError(err instanceof ApiError ? err.message : "Save failed.");
    } finally {
      setSavingPrefs(false);
    }
  }

  async function saveAi() {
    setSavingAi(true);
    setAiError("");
    setAiSuccess(false);
    try {
      await configApi.update({ ai: { model: aiModel } });
      if (anthropicKey) await configApi.saveSecret("anthropicKey", anthropicKey);
      setAiSuccess(true);
      setAnthropicKey("");
      setTimeout(() => setAiSuccess(false), 2500);
    } catch (err: unknown) {
      setAiError(err instanceof ApiError ? err.message : "Save failed.");
    } finally {
      setSavingAi(false);
    }
  }

  async function saveLinear() {
    if (!linearPat) return;
    setSavingLinear(true);
    try {
      await configApi.saveSecret("linearPat", linearPat);
      setLinearConfigured(true);
      setLinearPat("");
    } finally {
      setSavingLinear(false);
    }
  }

  async function saveGithub() {
    setSavingGithub(true);
    try {
      if (githubPat) await configApi.saveSecret("githubPat", githubPat);
      await configApi.update({
        integrations: {
          github: {
            defaultOwner: githubOwner || undefined,
            baseUrl: githubBaseUrl || undefined,
          },
        },
      });
      if (githubPat) { setGithubConfigured(true); setGithubPat(""); }
    } finally {
      setSavingGithub(false);
    }
  }

  async function saveJira() {
    setSavingJira(true);
    try {
      if (jiraPat) await configApi.saveSecret("jiraPat", jiraPat);
      if (jiraBaseUrl && jiraEmail) {
        await configApi.update({
          integrations: { jira: { baseUrl: jiraBaseUrl, email: jiraEmail, apiType: jiraApiType } },
        });
      }
      if (jiraPat) { setJiraConfigured(true); setJiraPat(""); }
    } finally {
      setSavingJira(false);
    }
  }

  async function saveGitlab() {
    setSavingGitlab(true);
    try {
      if (gitlabPat) await configApi.saveSecret("gitlabPat", gitlabPat);
      await configApi.update({
        integrations: { gitlab: { baseUrl: gitlabBaseUrl || undefined } },
      });
      if (gitlabPat) { setGitlabConfigured(true); setGitlabPat(""); }
    } finally {
      setSavingGitlab(false);
    }
  }

  async function saveNotion() {
    if (!notionToken) return;
    setSavingNotion(true);
    try {
      await configApi.saveSecret("notionToken", notionToken);
      setNotionConfigured(true);
      setNotionToken("");
    } finally {
      setSavingNotion(false);
    }
  }

  // ----------------------------------------------------------------
  // Test connection handlers
  // ----------------------------------------------------------------
  async function testConnection(
    source: "linear" | "github" | "jira" | "gitlab" | "notion",
    setStatus: (s: ConnectionStatus) => void,
    setError: (e: string) => void
  ) {
    setStatus("testing");
    const result = await integrationsApi.test(source).catch((e: unknown) => ({
      ok: false,
      error: e instanceof ApiError ? e.message : "Failed",
    }));
    if (result.ok) setStatus("ok");
    else { setStatus("error"); setError(result.error ?? "Failed"); }
  }

  if (loadError) {
    return (
      <div className="p-8">
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4">{loadError}</div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-2xl mx-auto space-y-8">
      <h1 className="text-2xl font-bold text-gray-900">Settings</h1>

      {/* ── Preferences ─────────────────────────────────────── */}
      <div className="card space-y-4">
        <SectionHeader title="Preferences" />
        <div>
          <label className="label">Company / product name</label>
          <input className="input" value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Acme Corp" />
        </div>
        <div>
          <label className="label">Brand color</label>
          <div className="flex items-center gap-3">
            <input type="color" value={brandColor} onChange={(e) => setBrandColor(e.target.value)} className="h-9 w-12 rounded cursor-pointer border border-gray-300" />
            <input className="input font-mono text-sm" value={brandColor} onChange={(e) => setBrandColor(e.target.value)} pattern="^#[0-9A-Fa-f]{6}$" />
          </div>
        </div>
        <div>
          <label className="label">Default template</label>
          <select className="input" value={defaultTemplate} onChange={(e) => setDefaultTemplate(e.target.value)}>
            <option value="minimal">Minimal — clean, typography-focused</option>
            <option value="changelog">Changelog — structured with badges</option>
            <option value="feature-launch">Feature Launch — marketing hero</option>
          </select>
        </div>
        <div>
          <label className="label">Page footer <span className="text-gray-400 font-normal">(optional)</span></label>
          <input className="input text-sm" value={pageFooter} onChange={(e) => setPageFooter(e.target.value)} placeholder="© 2025 Acme Corp. All rights reserved." maxLength={200} />
        </div>
        <div className="flex items-center gap-3">
          <SaveButton saving={savingPrefs} onClick={() => void savePreferences()} />
          {prefsSuccess && <span className="text-sm text-green-600">✓ Saved</span>}
          {prefsError && <span className="text-sm text-red-600">{prefsError}</span>}
        </div>
      </div>

      {/* ── AI ──────────────────────────────────────────────── */}
      <div className="card space-y-4">
        <SectionHeader title="AI" subtitle="Anthropic Claude is used to generate release pages." />
        <div>
          <label className="label">Model</label>
          <input className="input font-mono text-sm" value={aiModel} onChange={(e) => setAiModel(e.target.value)} placeholder="claude-sonnet-4-6" />
        </div>
        <div>
          <label className="label">Anthropic API key <span className="text-gray-400 font-normal">(leave blank to keep existing)</span></label>
          <PasswordInput value={anthropicKey} onChange={setAnthropicKey} placeholder="sk-ant-api03-…" />
        </div>
        <div className="flex items-center gap-3">
          <SaveButton saving={savingAi} onClick={() => void saveAi()} />
          {aiSuccess && <span className="text-sm text-green-600">✓ Saved</span>}
          {aiError && <span className="text-sm text-red-600">{aiError}</span>}
        </div>
      </div>

      {/* ── Integrations ────────────────────────────────────── */}
      <div>
        <h2 className="text-base font-semibold text-gray-900 mb-4">Integrations</h2>
        <div className="space-y-4">

          {/* Linear */}
          <div className="card space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3 className="font-medium">Linear</h3>
                {linearConfigured && <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full">configured</span>}
              </div>
              <StatusDot status={linearStatus} error={linearError} />
            </div>
            <div>
              <label className="label text-xs">New PAT <span className="text-gray-400 font-normal">(leave blank to keep existing)</span></label>
              <PasswordInput value={linearPat} onChange={setLinearPat} placeholder="lin_api_…" />
            </div>
            <div className="flex gap-2">
              <button className="btn-secondary text-sm" onClick={() => void testConnection("linear", setLinearStatus, setLinearError)} disabled={!linearConfigured && !linearPat}>
                Test connection
              </button>
              <SaveButton saving={savingLinear} onClick={() => void saveLinear()} />
            </div>
          </div>

          {/* GitHub */}
          <div className="card space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3 className="font-medium">GitHub Issues</h3>
                {githubConfigured && <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full">configured</span>}
              </div>
              <StatusDot status={githubStatus} error={githubError} />
            </div>
            <div>
              <label className="label text-xs">New PAT <span className="text-gray-400 font-normal">(leave blank to keep existing)</span></label>
              <PasswordInput value={githubPat} onChange={setGithubPat} placeholder="ghp_…" />
            </div>
            <div>
              <label className="label text-xs">Default owner / org</label>
              <input className="input text-sm" value={githubOwner} onChange={(e) => setGithubOwner(e.target.value)} placeholder="myorg" />
            </div>
            <div>
              <label className="label text-xs">Base URL <span className="text-gray-400 font-normal">(GitHub Enterprise only)</span></label>
              <input className="input text-sm" value={githubBaseUrl} onChange={(e) => setGithubBaseUrl(e.target.value)} placeholder="https://github.example.com/api/v3" />
            </div>
            <div className="flex gap-2">
              <button className="btn-secondary text-sm" onClick={() => void testConnection("github", setGithubStatus, setGithubError)} disabled={!githubConfigured && !githubPat}>
                Test connection
              </button>
              <SaveButton saving={savingGithub} onClick={() => void saveGithub()} />
            </div>
          </div>

          {/* Jira */}
          <div className="card space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3 className="font-medium">Jira</h3>
                {jiraConfigured && <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full">configured</span>}
              </div>
              <StatusDot status={jiraStatus} error={jiraError} />
            </div>
            <div>
              <label className="label text-xs">Jira type</label>
              <select className="input text-sm" value={jiraApiType} onChange={(e) => setJiraApiType(e.target.value as "cloud" | "server")}>
                <option value="cloud">Jira Cloud (atlassian.net)</option>
                <option value="server">Jira Server / Data Center</option>
              </select>
            </div>
            <div>
              <label className="label text-xs">Base URL</label>
              <input className="input text-sm" value={jiraBaseUrl} onChange={(e) => setJiraBaseUrl(e.target.value)} placeholder="https://mycompany.atlassian.net" />
            </div>
            <div>
              <label className="label text-xs">Email</label>
              <input type="email" className="input text-sm" value={jiraEmail} onChange={(e) => setJiraEmail(e.target.value)} placeholder="you@example.com" />
            </div>
            <div>
              <label className="label text-xs">New {jiraApiType === "cloud" ? "API token" : "PAT"} <span className="text-gray-400 font-normal">(leave blank to keep existing)</span></label>
              <PasswordInput value={jiraPat} onChange={setJiraPat} placeholder="Token…" />
            </div>
            <div className="flex gap-2">
              <button className="btn-secondary text-sm" onClick={() => void testConnection("jira", setJiraStatus, setJiraError)} disabled={!jiraConfigured && !jiraPat}>
                Test connection
              </button>
              <SaveButton saving={savingJira} onClick={() => void saveJira()} />
            </div>
          </div>

          {/* GitLab */}
          <div className="card space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3 className="font-medium">GitLab Issues</h3>
                {gitlabConfigured && <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full">configured</span>}
              </div>
              <StatusDot status={gitlabStatus} error={gitlabError} />
            </div>
            <div>
              <label className="label text-xs">New PAT <span className="text-gray-400 font-normal">(leave blank to keep existing)</span></label>
              <PasswordInput value={gitlabPat} onChange={setGitlabPat} placeholder="glpat-…" />
            </div>
            <div>
              <label className="label text-xs">Base URL <span className="text-gray-400 font-normal">(self-hosted only, default: gitlab.com)</span></label>
              <input className="input text-sm" value={gitlabBaseUrl} onChange={(e) => setGitlabBaseUrl(e.target.value)} placeholder="https://gitlab.example.com" />
            </div>
            <div className="flex gap-2">
              <button className="btn-secondary text-sm" onClick={() => void testConnection("gitlab", setGitlabStatus, setGitlabError)} disabled={!gitlabConfigured && !gitlabPat}>
                Test connection
              </button>
              <SaveButton saving={savingGitlab} onClick={() => void saveGitlab()} />
            </div>
          </div>

          {/* Notion */}
          <div className="card space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3 className="font-medium">Notion</h3>
                {notionConfigured && <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full">configured</span>}
              </div>
              <StatusDot status={notionStatus} error={notionError} />
            </div>
            <div>
              <label className="label text-xs">New integration token <span className="text-gray-400 font-normal">(leave blank to keep existing)</span></label>
              <PasswordInput value={notionToken} onChange={setNotionToken} placeholder="secret_…" />
            </div>
            <div className="flex gap-2">
              <button className="btn-secondary text-sm" onClick={() => void testConnection("notion", setNotionStatus, setNotionError)} disabled={!notionConfigured && !notionToken}>
                Test connection
              </button>
              <SaveButton saving={savingNotion} onClick={() => void saveNotion()} />
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
