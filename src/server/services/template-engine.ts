import Handlebars from "handlebars";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { SHIPPAGE_DIR } from "../config/store.js";
import { validateTemplateName, validateTemplateFilePath } from "../security/validate.js";
import type { GeneratedReleasePage } from "../../shared/types.js";

// ----------------------------------------------------------------
// Template Engine using Handlebars
//
// Why Handlebars instead of a custom {{}} regex parser:
//   - Handles loops ({{#each sections}}) needed for sections[]/items[]
//   - Handles conditionals ({{#if logoUrl}})
//   - Safe by default — no eval, no arbitrary code execution
//   - Well-tested, widely used
//
// Template search order:
//   1. ~/.shippage/templates/ (user custom — override built-ins)
//   2. <project>/templates/ (built-in)
// ----------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUILTIN_TEMPLATES_DIR = path.resolve(__dirname, "../../../templates");
const USER_TEMPLATES_DIR = path.join(SHIPPAGE_DIR, "templates");

// Register Handlebars helpers
Handlebars.registerHelper("eq", (a: unknown, b: unknown) => a === b);
Handlebars.registerHelper("or", (a: unknown, b: unknown) => a || b);
Handlebars.registerHelper("formatDate", (dateStr: string) => {
  try {
    return new Date(dateStr).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return dateStr;
  }
});

// ----------------------------------------------------------------
// Template discovery
// ----------------------------------------------------------------
export function listAvailableTemplates(): Array<{
  name: string;
  source: "builtin" | "user";
  path: string;
}> {
  const templates: Array<{ name: string; source: "builtin" | "user"; path: string }> = [];
  const seen = new Set<string>();

  // User templates override built-ins
  if (fs.existsSync(USER_TEMPLATES_DIR)) {
    for (const file of fs.readdirSync(USER_TEMPLATES_DIR)) {
      if (file.endsWith(".html")) {
        const name = file.replace(/\.html$/, "");
        if (validateTemplateName(name)) {
          const filePath = path.join(USER_TEMPLATES_DIR, file);
          templates.push({ name, source: "user", path: filePath });
          seen.add(name);
        }
      }
    }
  }

  // Built-in templates
  if (fs.existsSync(BUILTIN_TEMPLATES_DIR)) {
    for (const file of fs.readdirSync(BUILTIN_TEMPLATES_DIR)) {
      if (file.endsWith(".html")) {
        const name = file.replace(/\.html$/, "");
        if (!seen.has(name) && validateTemplateName(name)) {
          const filePath = path.join(BUILTIN_TEMPLATES_DIR, file);
          templates.push({ name, source: "builtin", path: filePath });
        }
      }
    }
  }

  return templates;
}

function resolveTemplatePath(templateName: string): string {
  if (!validateTemplateName(templateName)) {
    throw new Error(
      `Invalid template name: "${templateName}". ` +
        `Names must be alphanumeric with hyphens or underscores only.`
    );
  }

  const filename = `${templateName}.html`;

  // Check user templates first (allow overriding built-ins)
  const userPath = path.join(USER_TEMPLATES_DIR, filename);
  if (fs.existsSync(userPath)) {
    if (!validateTemplateFilePath(userPath)) {
      throw new Error("Template path validation failed.");
    }
    return userPath;
  }

  // Fall back to built-in templates
  const builtinPath = path.join(BUILTIN_TEMPLATES_DIR, filename);
  if (fs.existsSync(builtinPath)) {
    if (!validateTemplateFilePath(builtinPath)) {
      throw new Error("Template path validation failed.");
    }
    return builtinPath;
  }

  throw new Error(
    `Template not found: "${templateName}". ` +
      `Available templates: ${listAvailableTemplates()
        .map((t) => t.name)
        .join(", ")}`
  );
}

// ----------------------------------------------------------------
// Template rendering
// ----------------------------------------------------------------
export interface TemplateContext {
  headline: string;
  intro: string;
  sections: GeneratedReleasePage["sections"];
  cta: GeneratedReleasePage["cta"];
  brandColor: string;
  companyName: string;
  logoUrl: string | null;
  version: string;
  date: string;
  footer: string | null;
}

export function renderTemplate(
  templateName: string,
  context: TemplateContext
): string {
  const templatePath = resolveTemplatePath(templateName);
  const templateSource = fs.readFileSync(templatePath, "utf-8");

  const template = Handlebars.compile(templateSource);

  // allowProtoPropertiessByDefault/allowProtoMethodsByDefault are RuntimeOptions,
  // not CompileOptions — they belong on the template call, not compile().
  // Disabling both prevents prototype pollution attacks via template context.
  return template(context, {
    allowProtoPropertiesByDefault: false,
    allowProtoMethodsByDefault: false,
  });
}
