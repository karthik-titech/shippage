import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { releasesApi, ApiError } from "../lib/api.js";
import type { Release } from "../../shared/types.js";

export default function History() {
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

  const statusStyles = {
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
          {[1, 2, 3, 4, 5].map((i) => <div key={i} className="skeleton h-16 rounded-xl" />)}
        </div>
      ) : releases.length === 0 ? (
        <div className="card text-center py-16">
          <p className="text-gray-500 mb-4">No releases yet.</p>
          <Link to="/new" className="btn-primary">Create your first release</Link>
        </div>
      ) : (
        <div className="card divide-y divide-gray-100 p-0 overflow-hidden">
          {releases.map((release) => (
            <div key={release.id} className="flex items-center justify-between px-6 py-4 hover:bg-gray-50 transition-colors">
              <div>
                <div className="flex items-center gap-3">
                  <span className="font-medium text-gray-900">{release.projectName}</span>
                  <span className="font-mono text-sm text-gray-500">{release.version}</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusStyles[release.status]}`}>
                    {release.status}
                  </span>
                </div>
                {release.generatedContent?.headline && (
                  <p className="text-sm text-gray-500 mt-0.5 truncate max-w-lg">
                    {release.generatedContent.headline}
                  </p>
                )}
                <p className="text-xs text-gray-400 mt-0.5">
                  {new Date(release.createdAt).toLocaleDateString("en-US", {
                    month: "long", day: "numeric", year: "numeric",
                  })}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Link to={`/edit/${release.id}`} className="btn-ghost text-xs px-2 py-1">Edit</Link>
                <Link to={`/export/${release.id}`} className="btn-secondary text-xs px-2 py-1">Export</Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
