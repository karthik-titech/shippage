import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { releasesApi, exportApi, ApiError } from "../lib/api.js";
import type { Release } from "../../shared/types.js";

export default function Export() {
  const { id } = useParams<{ id: string }>();
  const [release, setRelease] = useState<Release | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState<{ path: string; sizeBytes: number } | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    releasesApi
      .get(id)
      .then((data) => setRelease((data as { release: Release }).release))
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Failed to load."))
      .finally(() => setLoading(false));
  }, [id]);

  async function handleExport(mode: "single-file" | "folder") {
    if (!id) return;
    setExporting(true);
    setError(null);
    try {
      const result = await exportApi.export(id, mode);
      setExportResult(result);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Export failed.");
    } finally {
      setExporting(false);
    }
  }

  async function handleCopyHtml() {
    if (!id) return;
    try {
      const html = await exportApi.getHtml(id);
      await navigator.clipboard.writeText(html);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch {
      setError("Could not copy to clipboard.");
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!release) {
    return (
      <div className="p-8">
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4">
          {error ?? "Release not found."}
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-8">
        <Link to={`/edit/${release.id}`} className="btn-ghost text-sm">
          ← Back to editor
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">Export</h1>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 mb-6 text-sm">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 mb-8">
        {/* Single file */}
        <div className="card">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="font-semibold">Single HTML File</h3>
              <p className="text-sm text-gray-500 mt-1">
                One self-contained <code className="bg-gray-100 px-1 rounded text-xs">index.html</code> with all
                CSS inlined. Images are base64-embedded (max 500KB each). Best for simple releases.
              </p>
            </div>
            <button
              className="btn-primary ml-4 flex-shrink-0"
              onClick={() => void handleExport("single-file")}
              disabled={exporting}
            >
              {exporting ? "Exporting..." : "Download"}
            </button>
          </div>
        </div>

        {/* Folder */}
        <div className="card">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="font-semibold">Folder (index.html + assets/)</h3>
              <p className="text-sm text-gray-500 mt-1">
                Separate HTML and image files. Better for releases with many images. Ideal for deploying
                to a static host directory.
              </p>
            </div>
            <button
              className="btn-secondary ml-4 flex-shrink-0"
              onClick={() => void handleExport("folder")}
              disabled={exporting}
            >
              {exporting ? "Exporting..." : "Download Folder"}
            </button>
          </div>
        </div>

        {/* Copy */}
        <div className="card">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="font-semibold">Copy HTML</h3>
              <p className="text-sm text-gray-500 mt-1">
                Copy the raw HTML to your clipboard. Paste into any file or CMS.
              </p>
            </div>
            <button
              className="btn-secondary ml-4 flex-shrink-0"
              onClick={() => void handleCopyHtml()}
            >
              {copySuccess ? "✓ Copied!" : "Copy HTML"}
            </button>
          </div>
        </div>
      </div>

      {/* Export result */}
      {exportResult && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-6 mb-8">
          <div className="flex items-start gap-3">
            <span className="text-2xl">✓</span>
            <div>
              <h3 className="font-semibold text-green-900">Exported successfully</h3>
              <p className="text-sm text-green-700 font-mono mt-1 break-all">{exportResult.path}</p>
              <p className="text-xs text-green-600 mt-1">{Math.round(exportResult.sizeBytes / 1024)}KB</p>
            </div>
          </div>
        </div>
      )}

      {/* Deploy instructions */}
      <div className="card">
        <h3 className="font-semibold mb-4">Deploy anywhere</h3>
        <div className="space-y-4 text-sm">
          <div>
            <p className="font-medium text-gray-700 mb-1">Vercel / Netlify</p>
            <p className="text-gray-500">Drag and drop the exported folder into Vercel or Netlify's dashboard.</p>
          </div>
          <div>
            <p className="font-medium text-gray-700 mb-1">GitHub Pages</p>
            <code className="block bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs font-mono text-gray-700">
              cp -r ~/.shippage/pages/{release.projectName}-{release.version}/ ./docs/
            </code>
          </div>
          <div>
            <p className="font-medium text-gray-700 mb-1">Serve locally</p>
            <code className="block bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs font-mono text-gray-700">
              npx serve ~/.shippage/pages/{release.projectName}-{release.version}/
            </code>
          </div>
          <div>
            <p className="font-medium text-gray-700 mb-1">S3 / Any static host</p>
            <p className="text-gray-500">Upload the <code className="bg-gray-100 px-1 rounded">index.html</code> (or the folder) to your bucket and set it as the index document.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
