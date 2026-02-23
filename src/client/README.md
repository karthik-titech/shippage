# src/client/ — React Frontend

A single-page React 18 application bundled by Vite. Runs in the browser, talks to the Express API on the same origin, and never makes direct calls to external services.

## Tech stack

| Layer | Technology |
|-------|-----------|
| Framework | React 18 |
| Router | React Router v6 |
| Styling | Tailwind CSS 3 + PostCSS |
| Build | Vite 5 |
| API client | Custom fetch wrapper (`lib/api.ts`) |
| Type safety | TypeScript 5.6, strict mode |

---

## Page routing

```
/              → Dashboard    (list of past releases)
/setup         → Setup        (first-run configuration wizard)
/select        → SelectTickets (pick tickets for a new release)
/editor/:id    → Editor       (edit generated content + live preview)
/export/:id    → Export       (download/export options)
/history/:id   → History      (AI generation audit log)
```

---

## Pages

### Dashboard.tsx

The home screen. Fetches `GET /api/releases` and renders a list of past releases with status badges (draft/published/archived). Provides:
- New release button → navigates to `/select`
- Click-through to Editor for any existing release
- Delete release with confirmation

### Setup.tsx

First-run (and re-run) configuration wizard. Rendered as a multi-step form:

```
Step 1: Choose issue tracker (Linear / GitHub Issues / Jira)
Step 2: Enter credentials for chosen tracker
        └── Test connection → POST /api/integrations/test
Step 3: Enter Anthropic API key
        └── Test API key format (basic client-side validation)
Step 4: Preferences (company name, brand color, default template)
```

Each step validates before allowing progression. Credentials are sent directly to the server which tests them against the real API; the frontend never sees a success/failure from the external service — only from its own API.

### SelectTickets.tsx

The ticket picker. Fetches completed tickets from the configured integration:

```
1. GET /api/integrations/projects → populate project dropdown
2. User selects project + date range
3. GET /api/integrations/tickets → load completed tickets
4. User checks which tickets to include
5. User fills in version string + template choice
6. Submit → POST /api/generate → redirect to /editor/:id
```

Displays ticket metadata (title, labels, assignee, linked Figma/Loom indicators).

### Editor.tsx

The main editing surface. Two-panel layout: form fields on the left, live HTML preview on the right.

#### AutoTextarea component

```typescript
function AutoTextarea({ value, onChange, ... }) {
  return (
    <textarea
      onInput={(e) => {
        // JS fallback for browsers without field-sizing: content
        el.style.height = "auto";
        el.style.height = `${el.scrollHeight}px`;
      }}
    />
  );
}
```

The CSS `field-sizing: content` auto-resizes textareas in modern browsers. The `onInput` handler provides an equivalent fallback for older browsers.

#### Edit flow

```
Edit field value
  └── setContent(draft) → local state update
        └── Preview iframe src refreshed
              └── GET /api/export/:id/html → sandboxed iframe
                    (sandbox="allow-same-origin": CSS renders, scripts blocked)

User clicks Save
  └── PATCH /api/releases/:id { content: draft }
        └── Server re-renders HTML → updates DB
```

#### Structure being edited

The editor maps 1:1 to the `GeneratedReleasePage` JSON structure:
- Top-level fields: headline, intro, CTA text, CTA URL
- Sections: add/remove/reorder sections
- Items within sections: add/remove/reorder items, edit title + description
- Media: add image/video placeholders per item

### Export.tsx

Export options page. Presents:
- **Single-file HTML**: one `.html` file with all images base64-encoded
- **Folder**: `index.html` + `assets/` directory with downloaded images
- Calls `POST /api/export { releaseId, mode }`
- Shows output file path after export

---

## lib/api.ts — API Client

A thin fetch wrapper that automatically:
1. Reads the CSRF token from `window.__CSRF_TOKEN__` (injected by Express at page serve time)
2. Includes it as `x-csrf-token` header on all non-GET requests
3. Parses JSON responses
4. Throws typed errors on non-2xx responses

```typescript
// Usage pattern:
const { releases } = await releasesApi.list({ status: "draft" });
const { release }  = await releasesApi.get(id);
await releasesApi.update(id, { content: editedContent });
```

Grouped namespaces:
- `configApi` — config read/write
- `integrationsApi` — test, projects, tickets
- `generateApi` — generate, rerender
- `releasesApi` — CRUD
- `exportApi` — export, templates

---

## styles/globals.css

```css
/* Tailwind directives */
@tailwind base;
@tailwind components;
@tailwind utilities;

/* Auto-resizing textarea (modern browsers) */
textarea {
  field-sizing: content;   /* CSS Working Draft — supported Chrome 123+, Safari 17.4+, Firefox 129+ */
  min-height: 2.5rem;
}
```

The JS fallback in `AutoTextarea.tsx` handles browsers without `field-sizing` support.
