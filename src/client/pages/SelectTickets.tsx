import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { integrationsApi, generateApi, ApiError } from "../lib/api.js";
import type { NormalizedTicket, IntegrationSource, GenerateResponse } from "../../shared/types.js";

const SOURCES: Array<{ value: IntegrationSource; label: string }> = [
  { value: "linear", label: "Linear" },
  { value: "github", label: "GitHub Issues" },
  { value: "jira", label: "Jira" },
  { value: "gitlab", label: "GitLab Issues" },
  { value: "notion", label: "Notion Database" },
];

const DEFAULT_SINCE = () => {
  const d = new Date();
  d.setDate(d.getDate() - 14);
  return d.toISOString().substring(0, 10); // "YYYY-MM-DD" — substring always returns string
};

export default function SelectTickets() {
  const navigate = useNavigate();

  const [source, setSource] = useState<IntegrationSource>("linear");
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [projectId, setProjectId] = useState("");
  const [since, setSince] = useState(DEFAULT_SINCE());
  const [tickets, setTickets] = useState<NormalizedTicket[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [version, setVersion] = useState("");

  const [loadingProjects, setLoadingProjects] = useState(false);
  const [loadingTickets, setLoadingTickets] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generatingStep, setGeneratingStep] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Load projects when source changes
  useEffect(() => {
    setProjects([]);
    setProjectId("");
    setTickets([]);
    setSelected(new Set());
    setLoadingProjects(true);
    setError(null);

    integrationsApi
      .projects(source)
      .then((data) => setProjects(data.projects))
      .catch((err: unknown) => {
        const msg = err instanceof ApiError ? err.message : "Failed to load projects.";
        setError(`${source} not configured or connection failed. ${msg}`);
      })
      .finally(() => setLoadingProjects(false));
  }, [source]);

  // Load tickets when project or date changes
  const loadTickets = useCallback(() => {
    if (!projectId) return;
    setLoadingTickets(true);
    setError(null);
    setSelected(new Set());

    integrationsApi
      .tickets({
        source,
        projectId,
        since: new Date(since).toISOString(),
        limit: 100,
      })
      .then((data) => setTickets(data.tickets as NormalizedTicket[]))
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Failed to load tickets."))
      .finally(() => setLoadingTickets(false));
  }, [source, projectId, since]);

  useEffect(() => {
    loadTickets();
  }, [loadTickets]);

  function toggleTicket(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === tickets.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(tickets.map((t) => t.externalId)));
    }
  }

  async function handleGenerate() {
    if (selected.size === 0 || !version.trim()) return;

    setGenerating(true);
    setError(null);

    const steps = [
      "Fetching ticket details...",
      "Analyzing release scope...",
      "Generating headlines...",
      "Building release page...",
    ];
    let stepIdx = 0;
    setGeneratingStep(steps[0] ?? "");
    const stepInterval = setInterval(() => {
      stepIdx = (stepIdx + 1) % steps.length;
      setGeneratingStep(steps[stepIdx] ?? "");
    }, 2500);

    try {
      const result = await generateApi.generate({
        ticketIds: [...selected],
        source,
        projectId,
        version: version.trim(),
        template: "minimal",
      });

      const { releaseId } = result as GenerateResponse;
      navigate(`/edit/${releaseId}`);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Generation failed. Check your Anthropic API key.");
    } finally {
      clearInterval(stepInterval);
      setGenerating(false);
    }
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">New Release</h1>
        <p className="text-gray-500 mt-1">Select completed tickets to include in this release.</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 mb-6 text-sm">
          {error}
        </div>
      )}

      {/* Step 1: Source + Project + Date + Version */}
      <div className="card mb-6">
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="label">Source</label>
            <select
              className="input"
              value={source}
              onChange={(e) => setSource(e.target.value as IntegrationSource)}
            >
              {SOURCES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Project</label>
            {loadingProjects ? (
              <div className="skeleton h-9 w-full rounded-lg" />
            ) : (
              <select
                className="input"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                disabled={projects.length === 0}
              >
                <option value="">Select a project...</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div>
            <label className="label">Completed since</label>
            <input
              type="date"
              className="input"
              value={since}
              onChange={(e) => setSince(e.target.value)}
            />
          </div>
          <div>
            <label className="label">
              Version <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              className="input"
              placeholder="e.g. v2.4 or 2024.12"
              value={version}
              onChange={(e) => setVersion(e.target.value)}
            />
            {!version.trim() && selected.size > 0 && (
              <p className="text-xs text-red-500 mt-1">Version is required before generating.</p>
            )}
          </div>
        </div>
      </div>

      {/* Step 2: Ticket list */}
      {loadingTickets ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="skeleton h-14 rounded-lg" />
          ))}
        </div>
      ) : tickets.length > 0 ? (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <button onClick={toggleAll} className="btn-ghost text-xs">
                {selected.size === tickets.length ? "Deselect all" : "Select all"}
              </button>
              <span className="text-sm text-gray-500">
                {tickets.length} tickets found
              </span>
            </div>
            {selected.size > 0 && (
              <span className="bg-blue-100 text-blue-700 px-2.5 py-1 rounded-full text-xs font-medium">
                {selected.size} selected
              </span>
            )}
          </div>

          <div className="divide-y divide-gray-100">
            {tickets.map((ticket) => (
              <label
                key={ticket.externalId}
                className="flex items-start gap-3 py-3 cursor-pointer hover:bg-gray-50 -mx-6 px-6 transition-colors"
              >
                <input
                  type="checkbox"
                  checked={selected.has(ticket.externalId)}
                  onChange={() => toggleTicket(ticket.externalId)}
                  className="mt-0.5 h-4 w-4 text-blue-600 rounded border-gray-300"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-start gap-2 flex-wrap">
                    <span className="text-sm font-medium text-gray-900 truncate">
                      {ticket.title}
                    </span>
                    {ticket.labels.map((label) => (
                      <span
                        key={label}
                        className="px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded text-xs flex-shrink-0"
                      >
                        {label}
                      </span>
                    ))}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5">
                    <span className="text-xs text-gray-400 font-mono">{ticket.externalId}</span>
                    {ticket.assignee && (
                      <span className="text-xs text-gray-400">{ticket.assignee}</span>
                    )}
                    {ticket.linkedFigma.length > 0 && (
                      <span className="text-xs text-purple-500">📐 Figma</span>
                    )}
                    {ticket.linkedLoom.length > 0 && (
                      <span className="text-xs text-blue-500">🎬 Loom</span>
                    )}
                  </div>
                </div>
              </label>
            ))}
          </div>
        </div>
      ) : projectId ? (
        <div className="card text-center py-12">
          <p className="text-gray-500">No completed tickets found for this project in the selected date range.</p>
          <button onClick={() => setSince("")} className="btn-secondary mt-3 text-sm">
            Remove date filter
          </button>
        </div>
      ) : null}

      {/* Generate button */}
      <div className="mt-6 flex justify-end">
        <button
          className="btn-primary px-6"
          disabled={selected.size === 0 || !version.trim() || generating}
          onClick={() => void handleGenerate()}
        >
          {generating ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              {generatingStep}
            </>
          ) : (
            <>
              Generate Release Page →
              {selected.size > 0 && (
                <span className="bg-blue-500 text-white text-xs rounded-full px-1.5 py-0.5 ml-1">
                  {selected.size}
                </span>
              )}
            </>
          )}
        </button>
      </div>
    </div>
  );
}
