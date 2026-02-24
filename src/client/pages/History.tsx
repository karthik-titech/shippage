import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { releasesApi, ApiError } from "../lib/api.js";
import type { Release, GenerationLogEntry } from "../../shared/types.js";

// ----------------------------------------------------------------
// Release list view — shown at /history
// ----------------------------------------------------------------
function ReleaseList() {
  const [releases, setReleases] = useState<Release[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    releasesApi
      .list({ limit: 100 })
      .then((data) => setReleases((data as { releases: Release[] }).releases))
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Failed to load."))
      .finally(() => setLoading(false));
  }, []);

  const statusStyles: Record<string, string> = {
    draft: "bg-gray-100 text-gray-600",
    published: "bg-green-100 text-green-700",
    archived: "bg-yellow-100 text-yellow-700",
  };

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Release History</h1>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 mb-6">
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="skeleton h-16 rounded-xl" />
          ))}
        </div>
      ) : releases.length === 0 ? (
        <div className="card text-center py-16">
          <p className="text-gray-500 mb-4">No releases yet.</p>
          <Link to="/new" className="btn-primary">
            Create your first release
          </Link>
        </div>
      ) : (
        <div className="card divide-y divide-gray-100 p-0 overflow-hidden">
          {releases.map((release) => (
            <div
              key={release.id}
              className="flex items-center justify-between px-6 py-4 hover:bg-gray-50 transition-colors"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="font-medium text-gray-900">{release.projectName}</span>
                  <span className="font-mono text-sm text-gray-500">{release.version}</span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusStyles[release.status] ?? "bg-gray-100 text-gray-600"}`}
                  >
                    {release.status}
                  </span>
                </div>
                {release.generatedContent?.headline && (
                  <p className="text-sm text-gray-500 mt-0.5 truncate">
                    {release.generatedContent.headline}
                  </p>
                )}
                <p className="text-xs text-gray-400 mt-0.5">
                  {new Date(release.createdAt).toLocaleDateString("en-US", {
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  })}
                </p>
              </div>
              <div className="flex items-center gap-2 ml-4 shrink-0">
                <Link
                  to={`/history/${release.id}`}
                  className="btn-ghost text-xs px-2 py-1"
                  title="View AI generation history"
                >
                  AI runs
                </Link>
                <Link to={`/edit/${release.id}`} className="btn-ghost text-xs px-2 py-1">
                  Edit
                </Link>
                <Link to={`/export/${release.id}`} className="btn-secondary text-xs px-2 py-1">
                  Export
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------
// Duration formatter
// ----------------------------------------------------------------
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ----------------------------------------------------------------
// Generation history detail view — shown at /history/:id
// ----------------------------------------------------------------
function ReleaseHistoryDetail({ releaseId }: { releaseId: string }) {
  const [release, setRelease] = useState<Release | null>(null);
  const [history, setHistory] = useState<GenerationLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      releasesApi.get(releaseId),
      releasesApi.history(releaseId),
    ])
      .then(([releaseData, historyData]) => {
        setRelease((releaseData as { release: Release }).release);
        setHistory((historyData as { history: GenerationLogEntry[] }).history);
      })
      .catch((err: unknown) =>
        setError(err instanceof ApiError ? err.message : "Failed to load.")
      )
      .finally(() => setLoading(false));
  }, [releaseId]);

  if (loading) {
    return (
      <div className="p-8 max-w-4xl mx-auto space-y-3">
        <div className="skeleton h-8 w-48 rounded-lg" />
        <div className="skeleton h-4 w-64 rounded" />
        {[1, 2, 3].map((i) => (
          <div key={i} className="skeleton h-20 rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-1">
        <Link to="/history" className="text-sm text-gray-400 hover:text-gray-600 transition-colors">
          ← All releases
        </Link>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 mb-6">
          {error}
        </div>
      )}

      {release && (
        <div className="mb-8">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-gray-900">{release.projectName}</h1>
            <span className="font-mono text-lg text-gray-500">{release.version}</span>
          </div>
          {release.generatedContent?.headline && (
            <p className="text-gray-500 mt-1">{release.generatedContent.headline}</p>
          )}
          <div className="flex items-center gap-3 mt-2">
            <Link to={`/edit/${release.id}`} className="btn-ghost text-xs px-2 py-1">
              Edit release
            </Link>
            <Link to={`/export/${release.id}`} className="btn-secondary text-xs px-2 py-1">
              Export
            </Link>
          </div>
        </div>
      )}

      <h2 className="text-lg font-semibold text-gray-800 mb-4">
        AI Generation Runs
        {history.length > 0 && (
          <span className="ml-2 text-sm font-normal text-gray-400">{history.length} run{history.length !== 1 ? "s" : ""}</span>
        )}
      </h2>

      {history.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-gray-400 text-sm">No generation runs recorded yet.</p>
          <p className="text-gray-400 text-xs mt-1">
            Generation history is logged each time you use AI to generate this release.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {history.map((entry, index) => (
            <div key={entry.id} className="card p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-bold shrink-0">
                    {history.length - index}
                  </div>
                  <div>
                    <div className="font-medium text-gray-900 text-sm">{entry.modelUsed}</div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      {new Date(entry.createdAt).toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                  </div>
                </div>
                <div className="text-xs text-gray-400 font-mono">
                  #{entry.id.slice(0, 8)}
                </div>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-4">
                <div>
                  <div className="text-xs text-gray-400 uppercase tracking-wide">Tokens in</div>
                  <div className="text-base font-semibold text-gray-800 mt-0.5">
                    {entry.tokensInput.toLocaleString()}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-400 uppercase tracking-wide">Tokens out</div>
                  <div className="text-base font-semibold text-gray-800 mt-0.5">
                    {entry.tokensOutput.toLocaleString()}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-400 uppercase tracking-wide">Duration</div>
                  <div className="text-base font-semibold text-gray-800 mt-0.5">
                    {formatDuration(entry.durationMs)}
                  </div>
                </div>
              </div>

              <div className="mt-3 pt-3 border-t border-gray-100">
                <div className="text-xs text-gray-400">
                  Total cost estimate:{" "}
                  <span className="font-medium text-gray-600">
                    ~${((entry.tokensInput * 0.000003 + entry.tokensOutput * 0.000015)).toFixed(4)}
                  </span>
                  <span className="ml-1 text-gray-400">(claude-sonnet-4 pricing)</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------
// Root export — routes to list or detail based on :id param
// ----------------------------------------------------------------
export default function History() {
  const { id } = useParams<{ id?: string }>();
  return id ? <ReleaseHistoryDetail releaseId={id} /> : <ReleaseList />;
}
