import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { releasesApi, generateApi, exportApi, ApiError } from "../lib/api.js";
import type { Release, GeneratedReleasePage, ReleaseSection, ReleaseSectionItem } from "../../shared/types.js";

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
        // Auto-resize
        const el = e.currentTarget;
        el.style.height = "auto";
        el.style.height = `${el.scrollHeight}px`;
      }}
    />
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

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rerendering, setRerendering] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [showRegeneratePanel, setShowRegeneratePanel] = useState(false);
  const [regenerateInstructions, setRegenerateInstructions] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      releasesApi.get(id),
      exportApi.getHtml(id).catch(() => ""),
      exportApi.templates(),
    ])
      .then(([releaseData, htmlData, templatesData]) => {
        const r = (releaseData as { release: Release }).release;
        setRelease(r);
        setContent(r.generatedContent);
        setHtml(htmlData);
        setSelectedTemplate(r.templateUsed);
        setTemplates((templatesData as { templates: Array<{ name: string; source: string }> }).templates);
      })
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Failed to load release."))
      .finally(() => setLoading(false));
  }, [id]);

  // Auto-save with debounce
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
        <div className="flex-1 flex items-center gap-4">
          <span className="font-semibold text-gray-900">
            {release.projectName} {release.version}
          </span>
          <select
            className="input text-sm w-44"
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
        </div>
        <div className="flex items-center gap-2">
          {saveSuccess && <span className="text-sm text-green-600">✓ Saved</span>}
          {saving && <span className="text-sm text-gray-500">Saving...</span>}
          {error && <span className="text-sm text-red-600">{error}</span>}
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
            <button
              onClick={() => void handleRegenerate()}
              className="btn-primary text-sm px-4"
            >
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
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {section.items.map((item, iIdx) => (
                  <div key={iIdx} className="bg-gray-50 rounded-lg p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        className="input font-medium text-sm flex-1"
                        value={item.title}
                        onChange={(e) =>
                          updateItem(sIdx, iIdx, { ...item, title: e.target.value })
                        }
                        placeholder="Item title..."
                      />
                      <button
                        onClick={() => removeItem(sIdx, iIdx)}
                        className="text-gray-400 hover:text-red-500 p-1"
                        title="Remove item"
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                    <AutoTextarea
                      value={item.description}
                      onChange={(v) => updateItem(sIdx, iIdx, { ...item, description: v })}
                      placeholder="Description..."
                      rows={2}
                      className="text-sm"
                    />
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

            <button
              onClick={addSection}
              className="btn-secondary w-full border-dashed"
            >
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
                    onChange={(e) => updateContent({ ...content, cta: { ...content.cta, text: e.target.value } })}
                  />
                </div>
                <div>
                  <label className="label text-xs">URL</label>
                  <input
                    type="url"
                    className="input text-sm"
                    value={content.cta.url}
                    placeholder="https://..."
                    onChange={(e) => updateContent({ ...content, cta: { ...content.cta, url: e.target.value } })}
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
            {rerendering && (
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
