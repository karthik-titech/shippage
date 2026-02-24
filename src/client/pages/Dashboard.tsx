import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { releasesApi, ApiError } from "../lib/api.js";
import type { Release } from "../../shared/types.js";

const PAGE_SIZE = 20;

type StatusFilter = "all" | "draft" | "published" | "archived";

const STATUS_TABS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "published", label: "Published" },
  { value: "archived", label: "Archived" },
];

function StatusBadge({ status }: { status: Release["status"] }) {
  const styles = {
    draft: "bg-gray-100 text-gray-700",
    published: "bg-green-100 text-green-700",
    archived: "bg-yellow-100 text-yellow-700",
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${styles[status]}`}>
      {status}
    </span>
  );
}

export default function Dashboard() {
  const [releases, setReleases] = useState<Release[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const fetchReleases = useCallback(
    async (newOffset: number, filter: StatusFilter, append: boolean) => {
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError(null);

      try {
        const data = await releasesApi.list({
          limit: PAGE_SIZE,
          offset: newOffset,
          status: filter === "all" ? undefined : filter,
        });
        const fetched = (data as { releases: Release[]; hasMore: boolean });
        if (append) {
          setReleases((prev) => [...prev, ...fetched.releases]);
        } else {
          setReleases(fetched.releases);
        }
        setHasMore(fetched.hasMore);
        setOffset(newOffset + fetched.releases.length);
      } catch (err: unknown) {
        setError(err instanceof ApiError ? err.message : "Failed to load releases.");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    []
  );

  useEffect(() => {
    setOffset(0);
    void fetchReleases(0, statusFilter, false);
  }, [statusFilter, fetchReleases]);

  function handleLoadMore() {
    void fetchReleases(offset, statusFilter, true);
  }

  function handleStatusFilter(filter: StatusFilter) {
    setStatusFilter(filter);
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-gray-500 mt-1">Your release pages, built locally.</p>
        </div>
        <Link to="/new" className="btn-primary">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Release
        </Link>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 mb-6">
          {error}
        </div>
      )}

      {/* Status filter tabs */}
      <div className="flex items-center gap-1 mb-5 border-b border-gray-200">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => handleStatusFilter(tab.value)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
              statusFilter === tab.value
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="skeleton h-16 w-full rounded-xl" />
          ))}
        </div>
      ) : releases.length === 0 ? (
        <div className="card text-center py-16">
          <div className="text-4xl mb-4">🚀</div>
          <h2 className="text-lg font-semibold text-gray-900 mb-2">
            {statusFilter === "all" ? "No releases yet" : `No ${statusFilter} releases`}
          </h2>
          <p className="text-gray-500 mb-6">
            {statusFilter === "all"
              ? "Connect Linear, GitHub, GitLab, Jira, or Notion and generate your first release page."
              : "Try a different filter or create a new release."}
          </p>
          {statusFilter === "all" && (
            <Link to="/new" className="btn-primary">
              Create your first release →
            </Link>
          )}
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {releases.map((release) => (
              <div
                key={release.id}
                className="card flex items-center justify-between hover:border-blue-200 transition-colors"
              >
                <div>
                  <div className="flex items-center gap-3">
                    <span className="font-semibold text-gray-900">{release.projectName}</span>
                    <span className="text-sm text-gray-500 font-mono">{release.version}</span>
                    <StatusBadge status={release.status} />
                  </div>
                  {release.generatedContent?.headline && (
                    <p className="text-sm text-gray-500 mt-0.5 truncate max-w-lg">
                      {release.generatedContent.headline}
                    </p>
                  )}
                  <p className="text-xs text-gray-400 mt-1">
                    {new Date(release.createdAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Link to={`/edit/${release.id}`} className="btn-secondary text-xs px-3 py-1.5">
                    Edit
                  </Link>
                  <Link to={`/export/${release.id}`} className="btn-primary text-xs px-3 py-1.5">
                    Export
                  </Link>
                </div>
              </div>
            ))}
          </div>

          {hasMore && (
            <div className="mt-6 flex justify-center">
              <button
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="btn-secondary px-6"
              >
                {loadingMore ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                    Loading...
                  </span>
                ) : (
                  "Load more"
                )}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
