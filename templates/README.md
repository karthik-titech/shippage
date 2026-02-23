# templates/ — HTML Release Page Templates

Three built-in Handlebars templates produce self-contained HTML release pages. All share the same data contract; only the visual layout differs.

## Available templates

| Template | Layout | Best for |
|----------|--------|----------|
| `minimal.html` | Single column, editorial | Developer tools, SaaS changelogs |
| `changelog.html` | Two-column with sticky sidebar nav | Frequent releases, many sections |
| `feature-launch.html` | Full-width hero + card grid | Big launches, marketing audiences |

---

## Data contract (Handlebars variables)

All templates receive the same context object:

```handlebars
{{headline}}          Release headline (string)
{{intro}}             2-3 sentence intro paragraph
{{version}}           Version string (e.g. "v2.4.0")
{{date}}              ISO date string → formatted by {{formatDate date}}
{{companyName}}       Company/product name
{{brandColor}}        Hex color injected into :root { --brand: ... }
{{logoUrl}}           Logo image URL (null = no logo)
{{footer}}            Footer text (null = no footer)

{{#each sections}}
  {{title}}           Section heading
  {{#each items}}
    {{title}}         Item title
    {{description}}   Item description
    {{#each media}}
      {{type}}        "image" or "video"
      {{url}}         Image URL or "#"
      {{alt}}         Alt text
    {{/each}}
  {{/each}}
{{/each}}

{{cta.text}}          Call-to-action button text
{{cta.url}}           Call-to-action URL
```

---

## Handlebars helpers (available in all templates)

### `{{#eq a b}}...{{/eq}}`

Block helper for equality checks. Used in `changelog.html` to assign CSS classes:

```handlebars
<span class="section-label {{#eq title "New Features"}}new{{else}}default{{/eq}}">
  {{title}}
</span>
```

### `{{or a b}}`

Returns first truthy value. Used for fallbacks:

```handlebars
{{or footer ""}}
```

### `{{formatDate date}}`

Formats an ISO 8601 date string as a human-readable date ("February 24, 2026").

---

## CSS architecture

Each template uses:
- **CSS custom properties** (`--brand`, `--text`, `--muted`, `--border`) for theming
- **`var(--brand)`** wherever the user's brand color should appear
- **`color-mix()`** for tinted backgrounds + shadows (modern browsers)
- **Fallback values** before every `color-mix()` call for older browsers

### color-mix() fallback pattern

```css
/* Correct pattern used in all templates: */
background: rgba(0, 0, 0, 0.06);                         /* fallback */
background: color-mix(in srgb, var(--brand) 10%, white); /* modern  */
```

CSS cascades: older browsers apply the first declaration; modern browsers override it with the second.

**Browser support for `color-mix()`:** Chrome 111+, Firefox 113+, Safari 16.2+

---

## Custom templates

Users can create their own templates by placing `.html` files in `~/.shippage/templates/`. The template engine checks user templates first, so a file named `minimal.html` in the user directory will override the built-in one.

Custom template names must match the allowlist in `validateTemplateName()`: alphanumeric characters, hyphens, and underscores only.

---

## Templates and the export pipeline

```
Claude generates JSON (GeneratedReleasePage)
        │
        ▼
renderTemplate(templateName, data)
  ├── Load .html file from disk
  ├── Handlebars.compile(source)
  └── template(data) → HTML string
        │
        ▼
Store in DB (generated_html column)
        │
        ▼
html-exporter: inline images → self-contained file
```
