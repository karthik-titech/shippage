import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { releasesApi, generateApi, exportApi, configApi, ApiError } from "../lib/api.js";
import type {
  Release,
  GeneratedReleasePage,
  ReleaseSection,
  ReleaseSectionItem,
  MediaBlock,
} from "../../shared/types.js";

// ----------------------------------------------------------------
// Structured Form Editor
//
// Instead of TipTap/ProseMirror, this editor is a set of
// auto-resizing textareas that map 1:1 to GeneratedReleasePage JSON.
//
// Benefits:
//   - No schema translation (JSON in = JSON out, no ProseMirror roundtrip)
//   - No 300KB+ bundle dependency
//   - Directly saves structured data (can re-render with different templates)
//   - Simpler to maintain and extend
//
// The right panel shows a sandboxed iframe preview.
// sandbox="allow-same-origin" allows CSS but blocks all script execution.
// ----------------------------------------------------------------

function AutoTextarea({
  value,
  onChange,
  placeholder,
  className = "",
  rows = 1,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  rows?: number;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      className={`editor-field ${className}`}
      style={{ resize: "none", overflow: "hidden" }}
      onInput={(e) => {
        const el = e.currentTarget;
        el.style.height = "auto";
        el.style.height = `${el.scrollHeight}px`;
      }}
    />
  );
}

// ----------------------------------------------------------------
// X icon (shared)
// ----------------------------------------------------------------
function XIcon({ size = 4 }: { size?: number }) {
  return (
    <svg className={`w-${size} h-${size}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

export default function Editor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [release, setRelease] = useState<Release | null>(null);
  const [content, setContent] = useState<GeneratedReleasePage | null>(null);
  const [html, setHtml] = useState<string>("");
  const [templates, setTemplates] = useState<Array<{ name: string; source: string }>>([]);
  const [selectedTemplate, setSelectedTemplate] = useState("minimal");

  // #5 — Brand color (loaded from config, editable live)
  const [brandColor, setBrandColor] = useState("#2563EB");

  // #6 — Published status + copy HTML
  const [status, setStatus] = useState<Release["status"]>("draft");
  const [publishing, setPublishing] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rerendering, setRerendering] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [showRegeneratePanel, setShowRegeneratePanel] = useState(false);
  const [regenerateInstructions, setRegenerateInstructions] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const brandColorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      releasesApi.get(id),
      exportApi.getHtml(id).catch(() => ""),
      exportApi.templates(),
      configApi.get(),
    ])
      .then(([releaseData, htmlData, templatesData, configData]) => {
        const r = (releaseData as { release: Release }).release;
        setRelease(r);
        setContent(r.generatedContent);
        setHtml(htmlData);
        setSelectedTemplate(r.templateUsed);
        setStatus(r.status);
        setTemplates((templatesData as { templates: Array<{ name: string; source: string }> }).templates);
        // Load brand color from config
        const prefs = (configData as { config: { preferences?: { brandColor?: string } } }).config.preferences;
        if (prefs?.brandColor) setBrandColor(prefs.brandColor);
      })
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Failed to load release."))
      .finally(() => setLoading(false));
  }, [id]);

  // Auto-save content with debounce
  const scheduleSave = useCallback(
    (newContent: GeneratedReleasePage) => {
      if (!id) return;
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(async () => {
        setSaving(true);
        try {
          const result = await releasesApi.update(id, { content: newContent });
          const updated = (result as { release: Release }).release;
          setHtml(updated.generatedHtml ?? "");
          setSaveSuccess(true);
          setTimeout(() => setSaveSuccess(false), 2000);
        } catch (err: unknown) {
          setError(err instanceof ApiError ? err.message : "Save failed.");
        } finally {
          setSaving(false);
        }
      }, 800);
    },
    [id]
  );

  function updateContent(newContent: GeneratedReleasePage) {
    setContent(newContent);
    scheduleSave(newContent);
  }

  function updateHeadline(v: string) {
    if (!content) return;
    updateContent({ ...content, headline: v });
  }

  function updateIntro(v: string) {
    if (!content) return;
    updateContent({ ...content, intro: v });
  }

  function updateSection(idx: number, section: ReleaseSection) {
    if (!content) return;
    const sections = [...content.sections];
    sections[idx] = section;
    updateContent({ ...content, sections });
  }

  function updateItem(sectionIdx: number, itemIdx: number, item: ReleaseSectionItem) {
    if (!content) return;
    const sections = content.sections.map((s, si) => {
      if (si !== sectionIdx) return s;
      const items = s.items.map((it, ii) => (ii === itemIdx ? item : it));
      return { ...s, items };
    });
    updateContent({ ...content, sections });
  }

  function addItem(sectionIdx: number) {
    if (!content) return;
    const sections = content.sections.map((s, si) => {
      if (si !== sectionIdx) return s;
      return {
        ...s,
        items: [...s.items, { title: "", description: "", ticketId: "", media: [] }],
      };
    });
    updateContent({ ...content, sections });
  }

  function removeItem(sectionIdx: number, itemIdx: number) {
    if (!content) return;
    const sections = content.sections.map((s, si) => {
      if (si !== sectionIdx) return s;
      return { ...s, items: s.items.filter((_, ii) => ii !== itemIdx) };
    });
    updateContent({ ...content, sections });
  }

  function addSection() {
    if (!content) return;
    updateContent({
      ...content,
      sections: [...content.sections, { title: "New Section", items: [] }],
    });
  }

  function removeSection(idx: number) {
    if (!content) return;
    updateContent({ ...content, sections: content.sections.filter((_, i) => i !== idx) });
  }

  // ----------------------------------------------------------------
  // #3 — Media block helpers
  // ----------------------------------------------------------------
  function updateMediaBlock(
    sectionIdx: number,
    itemIdx: number,
    mediaIdx: number,
    block: MediaBlock
  ) {
    if (!content) return;
    const item = content.sections[sectionIdx]!.items[itemIdx]!;
    const media = item.media.map((m, mi) => (mi === mediaIdx ? block : m));
    updateItem(sectionIdx, itemIdx, { ...item, media });
  }

  function addMediaBlock(sectionIdx: number, itemIdx: number) {
    if (!content) return;
    const item = content.sections[sectionIdx]!.items[itemIdx]!;
    updateItem(sectionIdx, itemIdx, {
      ...item,
      media: [...item.media, { type: "image", url: "", alt: "" }],
    });
  }

  function removeMediaBlock(sectionIdx: number, itemIdx: number, mediaIdx: number) {
    if (!content) return;
    const item = content.sections[sectionIdx]!.items[itemIdx]!;
    updateItem(sectionIdx, itemIdx, {
      ...item,
      media: item.media.filter((_, mi) => mi !== mediaIdx),
    });
  }

  // ----------------------------------------------------------------
  // Template change
  // ----------------------------------------------------------------
  async function handleTemplateChange(template: string) {
    if (!id) return;
    setRerendering(true);
    try {
      const result = await generateApi.rerender(id, template);
      setHtml(result.html);
      setSelectedTemplate(template);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Template change failed.");
    } finally {
      setRerendering(false);
    }
  }

  // ----------------------------------------------------------------
  // #5 — Brand color: save to config then re-render preview
  // ----------------------------------------------------------------
  function handleBrandColorChange(color: string) {
    setBrandColor(color);
    if (brandColorTimeoutRef.current) clearTimeout(brandColorTimeoutRef.current);
    brandColorTimeoutRef.current = setTimeout(async () => {
      try {
        await configApi.update({ preferences: { brandColor: color } });
        if (!id) return;
        setRerendering(true);
        const result = await generateApi.rerender(id, selectedTemplate);
        setHtml(result.html);
      } catch (err: unknown) {
        setError(err instanceof ApiError ? err.message : "Color update failed.");
      } finally {
        setRerendering(false);
      }
    }, 600);
  }

  // ----------------------------------------------------------------
  // Regenerate
  // ----------------------------------------------------------------
  async function handleRegenerate() {
    if (!id) return;
    setError(null);
    setRegenerating(true);
    setShowRegeneratePanel(false);
    try {
      const result = await generateApi.regenerate(id, {
        customInstructions: regenerateInstructions.trim() || undefined,
      });
      setContent((result as { content: GeneratedReleasePage }).content);
      setHtml((result as { html: string }).html);
      setRegenerateInstructions("");
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Regeneration failed.");
    } finally {
      setRegenerating(false);
    }
  }

  // ----------------------------------------------------------------
  // #6 — Publish / unpublish
  // ----------------------------------------------------------------
  async function handleTogglePublish() {
    if (!id) return;
    setPublishing(true);
    const newStatus: Release["status"] = status === "published" ? "draft" : "published";
    try {
      await releasesApi.update(id, { status: newStatus });
      setStatus(newStatus);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Status update failed.");
    } finally {
      setPublishing(false);
    }
  }

  // #6 — Copy HTML to clipboard
  async function handleCopyHtml() {
    if (!id) return;
    try {
      const rawHtml = await exportApi.getHtml(id);
      await navigator.clipboard.writeText(rawHtml);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch {
      setError("Could not copy HTML to clipboard.");
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!release || !content) {
    return (
      <div className="p-8">
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4">
          {error ?? "Release not found."}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen">
      {/* Top bar */}
      <div className="border-b border-gray-200 bg-white px-6 py-3 flex items-center gap-4">
        <div className="flex-1 flex items-center gap-3 min-w-0">
          <span className="font-semibold text-gray-900 truncate">
            {release.projectName} {release.version}
          </span>
          <select
            className="input text-sm w-44 shrink-0"
            value={selectedTemplate}
            onChange={(e) => void handleTemplateChange(e.target.value)}
            disabled={rerendering}
          >
            {templates.map((t) => (
              <option key={t.name} value={t.name}>
                {t.name}
              </option>
            ))}
          </select>
          {/* #5 — Brand color picker */}
          <div className="flex items-center gap-1.5 shrink-0" title="Brand color">
            <input
              type="color"
              value={brandColor}
              onChange={(e) => handleBrandColorChange(e.target.value)}
              className="h-7 w-7 rounded cursor-pointer border border-gray-300 p-0.5"
            />
            <span className="text-xs text-gray-400 font-mono hidden sm:block">{brandColor}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {saveSuccess && <span className="text-sm text-green-600">✓ Saved</span>}
          {saving && <span className="text-sm text-gray-500">Saving…</span>}
          {error && <span className="text-sm text-red-600 max-w-xs truncate">{error}</span>}

          <button
            onClick={() => setShowRegeneratePanel((v) => !v)}
            className="btn-ghost text-sm"
            disabled={regenerating}
          >
            {regenerating ? (
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                Regenerating…
              </span>
            ) : "Regenerate"}
          </button>

          {/* #6 — Publish toggle */}
          <button
            onClick={() => void handleTogglePublish()}
            disabled={publishing}
            className={`text-sm px-3 py-1.5 rounded-lg border font-medium transition-colors ${
              status === "published"
                ? "border-green-300 bg-green-50 text-green-700 hover:bg-green-100"
                : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
            }`}
          >
            {publishing ? "…" : status === "published" ? "✓ Published" : "Publish"}
          </button>

          {/* #6 — Copy HTML (shown when published) */}
          {status === "published" && (
            <button onClick={() => void handleCopyHtml()} className="btn-ghost text-sm">
              {copySuccess ? "✓ Copied!" : "Copy HTML"}
            </button>
          )}

          <button
            onClick={() => navigate(`/export/${release.id}`)}
            className="btn-primary text-sm"
          >
            Export →
          </button>
        </div>
      </div>

      {/* Regenerate confirm panel */}
      {showRegeneratePanel && (
        <div className="border-b border-amber-200 bg-amber-50 px-6 py-4">
          <p className="text-sm font-medium text-amber-800 mb-3">
            Re-run AI generation using the original tickets. This will overwrite your current edits.
          </p>
          <div className="mb-3">
            <label className="label text-xs text-amber-700">Custom instructions (optional)</label>
            <textarea
              className="input text-sm resize-none"
              rows={2}
              placeholder="e.g. Focus on developer-facing changes. Use a more concise tone."
              value={regenerateInstructions}
              onChange={(e) => setRegenerateInstructions(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => void handleRegenerate()} className="btn-primary text-sm px-4">
              Regenerate with AI
            </button>
            <button
              onClick={() => { setShowRegeneratePanel(false); setRegenerateInstructions(""); }}
              className="btn-ghost text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Split panel */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Regenerating overlay */}
        {regenerating && (
          <div className="absolute inset-0 z-10 bg-white/80 flex flex-col items-center justify-center gap-3">
            <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm font-medium text-gray-700">Calling Claude…</p>
            <p className="text-xs text-gray-400">This usually takes 5–15 seconds</p>
          </div>
        )}

        {/* Left: Structured editor */}
        <div className="w-1/2 overflow-y-auto p-6 border-r border-gray-200 bg-white">
          <div className="max-w-xl space-y-6">
            {/* Headline */}
            <div>
              <label className="label">Headline</label>
              <AutoTextarea
                value={content.headline}
                onChange={updateHeadline}
                placeholder="Your release headline..."
                className="editor-headline"
              />
            </div>

            {/* Intro */}
            <div>
              <label className="label">Introduction</label>
              <AutoTextarea
                value={content.intro}
                onChange={updateIntro}
                placeholder="2-3 sentences summarizing this release..."
                rows={3}
              />
            </div>

            {/* Sections */}
            {content.sections.map((section, sIdx) => (
              <div key={sIdx} className="border border-gray-200 rounded-xl p-4 space-y-4">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    className="input font-semibold flex-1"
                    value={section.title}
                    onChange={(e) => updateSection(sIdx, { ...section, title: e.target.value })}
                    placeholder="Section title..."
                  />
                  <button
                    onClick={() => removeSection(sIdx)}
                    className="text-gray-400 hover:text-red-500 transition-colors p-1"
                    title="Remove section"
                  >
                    <XIcon size={4} />
                  </button>
                </div>

                {section.items.map((item, iIdx) => (
                  <div key={iIdx} className="bg-gray-50 rounded-lg p-3 space-y-2">
                    {/* Item title + remove */}
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        className="input font-medium text-sm flex-1"
                        value={item.title}
                        onChange={(e) => updateItem(sIdx, iIdx, { ...item, title: e.target.value })}
                        placeholder="Item title..."
                      />
                      <button
                        onClick={() => removeItem(sIdx, iIdx)}
                        className="text-gray-400 hover:text-red-500 p-1"
                        title="Remove item"
                      >
                        <XIcon size={3} />
                      </button>
                    </div>

                    {/* Description */}
                    <AutoTextarea
                      value={item.description}
                      onChange={(v) => updateItem(sIdx, iIdx, { ...item, description: v })}
                      placeholder="Description..."
                      rows={2}
                      className="text-sm"
                    />

                    {/* #3 — Media blocks */}
                    {item.media.length > 0 && (
                      <div className="space-y-2 pt-1">
                        <label className="label text-xs text-gray-500">Images / Videos</label>
                        {item.media.map((block, mIdx) => (
                          <div
                            key={mIdx}
                            className="rounded border border-gray-200 bg-white p-2 space-y-1.5"
                          >
                            <div className="flex items-center gap-1.5">
                              <span className="text-sm w-5 shrink-0 text-center">
                                {block.type === "image" ? "🖼" : "🎬"}
                              </span>
                              <select
                                className="input text-xs w-24 shrink-0"
                                value={block.type}
                                onChange={(e) =>
                                  updateMediaBlock(sIdx, iIdx, mIdx, {
                                    ...block,
                                    type: e.target.value as "image" | "video",
                                  })
                                }
                              >
                                <option value="image">Image</option>
                                <option value="video">Video</option>
                              </select>
                              <button
                                onClick={() => removeMediaBlock(sIdx, iIdx, mIdx)}
                                className="ml-auto text-gray-300 hover:text-red-400 p-0.5"
                                title="Remove media"
                              >
                                <XIcon size={3} />
                              </button>
                            </div>
                            <input
                              type="url"
                              className={`input text-xs font-mono w-full ${
                                block.url === "#" || block.url === ""
                                  ? "border-amber-300 bg-amber-50 focus:border-amber-400"
                                  : ""
                              }`}
                              value={block.url}
                              placeholder="https://example.com/screenshot.png"
                              onChange={(e) =>
                                updateMediaBlock(sIdx, iIdx, mIdx, { ...block, url: e.target.value })
                              }
                            />
                            {(block.url === "#" || block.url === "") && (
                              <p className="text-xs text-amber-600">
                                ⚠ Add a real URL to show this {block.type} in the page
                              </p>
                            )}
                            <input
                              type="text"
                              className="input text-xs w-full"
                              value={block.alt}
                              placeholder="Alt text (e.g. Screenshot of the new dashboard)"
                              onChange={(e) =>
                                updateMediaBlock(sIdx, iIdx, mIdx, { ...block, alt: e.target.value })
                              }
                            />
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Add image button */}
                    <button
                      onClick={() => addMediaBlock(sIdx, iIdx)}
                      className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
                    >
                      + Add image
                    </button>
                  </div>
                ))}

                <button
                  onClick={() => addItem(sIdx)}
                  className="btn-ghost text-xs w-full border border-dashed border-gray-300"
                >
                  + Add item
                </button>
              </div>
            ))}

            <button onClick={addSection} className="btn-secondary w-full border-dashed">
              + Add section
            </button>

            {/* CTA */}
            <div className="border border-gray-200 rounded-xl p-4 space-y-3">
              <h3 className="text-sm font-semibold text-gray-700">Call to Action</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label text-xs">Button text</label>
                  <input
                    type="text"
                    className="input text-sm"
                    value={content.cta.text}
                    onChange={(e) =>
                      updateContent({ ...content, cta: { ...content.cta, text: e.target.value } })
                    }
                  />
                </div>
                <div>
                  <label className="label text-xs">URL</label>
                  <input
                    type="url"
                    className="input text-sm"
                    value={content.cta.url}
                    placeholder="https://..."
                    onChange={(e) =>
                      updateContent({ ...content, cta: { ...content.cta, url: e.target.value } })
                    }
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Live preview */}
        <div className="w-1/2 overflow-hidden bg-gray-100 flex flex-col">
          <div className="px-4 py-2 bg-gray-50 border-b border-gray-200 flex items-center gap-2">
            <span className="text-xs text-gray-500 font-medium">Preview</span>
            {(rerendering) && (
              <div className="w-3 h-3 border border-blue-500 border-t-transparent rounded-full animate-spin" />
            )}
            <span className="text-xs text-gray-400 ml-auto">Sandboxed — scripts disabled</span>
          </div>
          {/* SECURITY: sandbox="allow-same-origin" allows CSS but blocks all script execution.
              srcdoc avoids any network requests. Third-party content in the iframe
              cannot access localStorage, cookies, or make requests on our behalf. */}
          <iframe
            srcDoc={html || "<p style='padding:2rem;color:#666'>No preview yet.</p>"}
            sandbox="allow-same-origin"
            className="flex-1 w-full bg-white"
            title="Release page preview"
          />
        </div>
      </div>
    </div>
  );
}
