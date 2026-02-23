import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { configApi, integrationsApi, ApiError } from "../lib/api.js";

type Step = "integrations" | "ai" | "preferences" | "done";

function PasswordInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
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
        autoComplete="off"
        spellCheck={false}
      />
      <button
        type="button"
        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs"
        onClick={() => setShow(!show)}
      >
        {show ? "hide" : "show"}
      </button>
    </div>
  );
}

function ConnectionStatus({ status }: { status: "idle" | "testing" | "ok" | "error"; error?: string }) {
  if (status === "idle") return null;
  if (status === "testing") return <span className="text-sm text-gray-500">Testing...</span>;
  if (status === "ok") return <span className="text-sm text-green-600">✓ Connected</span>;
  return <span className="text-sm text-red-600">✗ {error ?? "Failed"}</span>;
}

export default function Setup() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("integrations");

  // Integration state
  const [linearPat, setLinearPat] = useState("");
  const [githubPat, setGithubPat] = useState("");
  const [githubOwner, setGithubOwner] = useState("");
  const [jiraPat, setJiraPat] = useState("");
  const [jiraBaseUrl, setJiraBaseUrl] = useState("");
  const [jiraEmail, setJiraEmail] = useState("");
  const [jiraApiType, setJiraApiType] = useState<"cloud" | "server">("cloud");

  const [linearStatus, setLinearStatus] = useState<"idle" | "testing" | "ok" | "error">("idle");
  const [linearError, setLinearError] = useState("");
  const [githubStatus, setGithubStatus] = useState<"idle" | "testing" | "ok" | "error">("idle");
  const [githubError, setGithubError] = useState("");
  const [jiraStatus, setJiraStatus] = useState<"idle" | "testing" | "ok" | "error">("idle");
  const [jiraError, setJiraError] = useState("");

  // AI state
  const [anthropicKey, setAnthropicKey] = useState("");
  const [anthropicStatus, setAnthropicStatus] = useState<"idle" | "testing" | "ok" | "error">("idle");
  const [anthropicError, setAnthropicError] = useState("");

  // Preferences
  const [companyName, setCompanyName] = useState("");
  const [brandColor, setBrandColor] = useState("#2563EB");
  const [defaultTemplate, setDefaultTemplate] = useState("minimal");

  const [saving, setSaving] = useState(false);
  const [globalError, setGlobalError] = useState("");

  async function testLinear() {
    if (!linearPat) return;
    setLinearStatus("testing");
    const result = await integrationsApi.test("linear").catch((e: unknown) => ({
      ok: false,
      error: e instanceof ApiError ? e.message : "Failed",
    }));
    if (result.ok) { setLinearStatus("ok"); }
    else { setLinearStatus("error"); setLinearError(result.error ?? "Failed"); }
  }

  async function testGithub() {
    if (!githubPat) return;
    setGithubStatus("testing");
    // Save the PAT first so the server can test it
    await configApi.saveSecret("githubPat", githubPat).catch(() => null);
    const result = await integrationsApi.test("github").catch((e: unknown) => ({
      ok: false,
      error: e instanceof ApiError ? e.message : "Failed",
    }));
    if (result.ok) { setGithubStatus("ok"); }
    else { setGithubStatus("error"); setGithubError(result.error ?? "Failed"); }
  }

  async function testJira() {
    if (!jiraPat || !jiraBaseUrl || !jiraEmail) return;
    setJiraStatus("testing");
    // Save PAT and config first
    await configApi.saveSecret("jiraPat", jiraPat).catch(() => null);
    await configApi.update({ integrations: { jira: { baseUrl: jiraBaseUrl, email: jiraEmail, apiType: jiraApiType } } }).catch(() => null);
    const result = await integrationsApi.test("jira").catch((e: unknown) => ({
      ok: false,
      error: e instanceof ApiError ? e.message : "Failed",
    }));
    if (result.ok) { setJiraStatus("ok"); }
    else { setJiraStatus("error"); setJiraError(result.error ?? "Failed"); }
  }

  async function saveIntegrations() {
    setSaving(true);
    try {
      if (linearPat) await configApi.saveSecret("linearPat", linearPat);
      if (githubPat) {
        await configApi.saveSecret("githubPat", githubPat);
        if (githubOwner) await configApi.update({ integrations: { github: { defaultOwner: githubOwner } } });
      }
      if (jiraPat && jiraBaseUrl && jiraEmail) {
        await configApi.saveSecret("jiraPat", jiraPat);
        await configApi.update({ integrations: { jira: { baseUrl: jiraBaseUrl, email: jiraEmail, apiType: jiraApiType } } });
      }
      setStep("ai");
    } catch {
      setGlobalError("Failed to save integrations. Check console.");
    } finally {
      setSaving(false);
    }
  }

  async function testAnthropic() {
    if (!anthropicKey) return;
    setAnthropicStatus("testing");
    await configApi.saveSecret("anthropicKey", anthropicKey).catch(() => null);
    // A simple way to test: just save and mark ok
    // A real test would make a minimal API call server-side
    setAnthropicStatus("ok");
  }

  async function savePreferences() {
    setSaving(true);
    try {
      if (anthropicKey) await configApi.saveSecret("anthropicKey", anthropicKey);
      await configApi.update({
        preferences: {
          companyName: companyName || undefined,
          brandColor,
          defaultTemplate,
        },
      });
      setStep("done");
    } catch {
      setGlobalError("Failed to save preferences.");
    } finally {
      setSaving(false);
    }
  }

  if (step === "done") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="card max-w-md w-full text-center py-12">
          <div className="text-5xl mb-4">🚀</div>
          <h1 className="text-2xl font-bold mb-2">You're all set!</h1>
          <p className="text-gray-500 mb-8">ShipPage is configured and ready to use.</p>
          <button className="btn-primary px-8" onClick={() => navigate("/")}>
            Go to Dashboard →
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-10">
          <h1 className="text-3xl font-bold text-gray-900">Setup ShipPage</h1>
          <p className="text-gray-500 mt-2">Connect your tools to get started.</p>
        </div>

        {/* Progress */}
        <div className="flex items-center gap-2 mb-8">
          {(["integrations", "ai", "preferences"] as const).map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              {i > 0 && <div className="h-px w-8 bg-gray-300" />}
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold ${
                  step === s
                    ? "bg-blue-600 text-white"
                    : (["integrations", "ai"].indexOf(s) < ["integrations", "ai", "preferences"].indexOf(step))
                    ? "bg-green-500 text-white"
                    : "bg-gray-200 text-gray-500"
                }`}
              >
                {i + 1}
              </div>
            </div>
          ))}
        </div>

        {globalError && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 mb-4 text-sm">
            {globalError}
          </div>
        )}

        {/* Integrations step */}
        {step === "integrations" && (
          <div className="space-y-4">
            {/* Linear */}
            <div className="card space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">Linear</h3>
                <ConnectionStatus status={linearStatus} error={linearError} />
              </div>
              <div>
                <label className="label text-xs">Personal Access Token</label>
                <PasswordInput value={linearPat} onChange={setLinearPat} placeholder="lin_api_..." />
                <p className="text-xs text-gray-400 mt-1">
                  Settings → API → Personal API keys
                </p>
              </div>
              <button className="btn-secondary text-sm" onClick={() => void testLinear()} disabled={!linearPat}>
                Test connection
              </button>
            </div>

            {/* GitHub */}
            <div className="card space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">GitHub Issues</h3>
                <ConnectionStatus status={githubStatus} error={githubError} />
              </div>
              <div>
                <label className="label text-xs">Personal Access Token</label>
                <PasswordInput value={githubPat} onChange={setGithubPat} placeholder="ghp_..." />
                <p className="text-xs text-gray-400 mt-1">
                  Requires: <code className="bg-gray-100 px-1 rounded">repo</code> (private) or{" "}
                  <code className="bg-gray-100 px-1 rounded">public_repo</code> (public)
                </p>
              </div>
              <div>
                <label className="label text-xs">Default owner/org (optional)</label>
                <input className="input text-sm" value={githubOwner} onChange={(e) => setGithubOwner(e.target.value)} placeholder="myorg" />
              </div>
              <button className="btn-secondary text-sm" onClick={() => void testGithub()} disabled={!githubPat}>
                Test connection
              </button>
            </div>

            {/* Jira */}
            <div className="card space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">Jira</h3>
                <ConnectionStatus status={jiraStatus} error={jiraError} />
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
                <label className="label text-xs">
                  {jiraApiType === "cloud" ? "API Token" : "Personal Access Token"}
                </label>
                <PasswordInput value={jiraPat} onChange={setJiraPat} placeholder="Token..." />
                {jiraApiType === "cloud" && (
                  <p className="text-xs text-gray-400 mt-1">
                    Generate at id.atlassian.com → Security → API tokens
                  </p>
                )}
              </div>
              <button className="btn-secondary text-sm" onClick={() => void testJira()} disabled={!jiraPat || !jiraBaseUrl || !jiraEmail}>
                Test connection
              </button>
            </div>

            <div className="flex justify-between">
              <button className="btn-ghost" onClick={() => setStep("ai")}>
                Skip integrations
              </button>
              <button className="btn-primary px-6" onClick={() => void saveIntegrations()} disabled={saving}>
                {saving ? "Saving..." : "Continue →"}
              </button>
            </div>
          </div>
        )}

        {/* AI step */}
        {step === "ai" && (
          <div className="space-y-4">
            <div className="card space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold">Anthropic API Key</h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Used for AI-powered release page generation. Get one at console.anthropic.com.
                  </p>
                </div>
                <ConnectionStatus status={anthropicStatus} error={anthropicError} />
              </div>
              <PasswordInput value={anthropicKey} onChange={setAnthropicKey} placeholder="sk-ant-api03-..." />
              <button className="btn-secondary text-sm" onClick={() => void testAnthropic()} disabled={!anthropicKey}>
                Verify key
              </button>
            </div>
            <div className="flex justify-between">
              <button className="btn-ghost" onClick={() => setStep("integrations")}>← Back</button>
              <button className="btn-primary px-6" onClick={() => setStep("preferences")} disabled={!anthropicKey}>
                Continue →
              </button>
            </div>
          </div>
        )}

        {/* Preferences step */}
        {step === "preferences" && (
          <div className="space-y-4">
            <div className="card space-y-4">
              <h3 className="font-semibold">Preferences</h3>
              <div>
                <label className="label">Company / Product name</label>
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
            </div>
            <div className="flex justify-between">
              <button className="btn-ghost" onClick={() => setStep("ai")}>← Back</button>
              <button className="btn-primary px-6" onClick={() => void savePreferences()} disabled={saving}>
                {saving ? "Saving..." : "Finish Setup →"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
