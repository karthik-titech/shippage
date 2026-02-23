#!/usr/bin/env node

// ----------------------------------------------------------------
// ShipPage CLI Entry Point
// This file must remain plain JavaScript (no TypeScript, no JSX).
// It bootstraps the compiled server and handles CLI commands.
// ----------------------------------------------------------------

// Check Node.js version before anything else
const [major] = process.versions.node.split(".").map(Number);
if (major < 18) {
  console.error(
    `\nShipPage requires Node.js >= 18. You are running Node.js ${process.versions.node}.\n` +
      `Please upgrade: https://nodejs.org/\n`
  );
  process.exit(1);
}

// Dynamic import of the TypeScript-compiled server
// (compiled to dist/server/ by `pnpm build`)
async function main() {
  try {
    const { program } = await import("commander");
    const { default: open } = await import("open");
    const { createServer } = await import("../dist/server/index.js");
    const { ensureShipPageDirs, readConfig } = await import("../dist/server/config/store.js");
    const { getDb } = await import("../dist/server/db/index.js");

    const pkg = JSON.parse(
      (await import("fs")).readFileSync(
        new URL("../package.json", import.meta.url),
        "utf-8"
      )
    );

    program
      .name("shippage")
      .description("Turn your changelog into a release marketing page in one click.")
      .version(pkg.version);

    // Default command: start server + open UI
    program
      .command("start", { isDefault: true })
      .description("Start the ShipPage server and open the UI")
      .option("-p, --port <port>", "Port to listen on", "4378")
      .option("--dev", "Start in development mode (proxy to Vite)")
      .option("--no-open", "Don't open the browser automatically")
      .action(async (options) => {
        const port = parseInt(process.env["SHIPPAGE_PORT"] ?? options.port, 10);

        // First-run check
        const isFirstRun = await checkFirstRun();
        if (isFirstRun) {
          console.log("\n👋 Welcome to ShipPage! Let's get you set up first.\n");
          await runInit();
        }

        const { app, start } = await createServer({ devMode: options.dev });
        const actualPort = await start(port);

        const url = `http://localhost:${actualPort}`;
        console.log(`\n✓ ShipPage is running at ${url}\n`);

        if (options.open !== false) {
          await open(url).catch(() => {
            console.log(`Open your browser and navigate to: ${url}`);
          });
        }
      });

    // init: interactive first-run setup
    program
      .command("init")
      .description("Run the interactive setup wizard")
      .action(runInit);

    // config: print current config (redacted)
    program
      .command("config")
      .description("Print current configuration (secrets redacted)")
      .action(async () => {
        const { getSecretStatus } = await import("../dist/server/config/store.js");
        const config = readConfig();
        const secrets = await getSecretStatus();

        console.log("\nShipPage Configuration\n" + "─".repeat(40));
        console.log(`Version:  ${config.version}`);
        console.log(`\nIntegrations:`);
        console.log(`  Linear:  ${secrets.linear ? "✓ configured" : "✗ not configured"}`);
        console.log(`  GitHub:  ${secrets.github ? "✓ configured" : "✗ not configured"}`);
        console.log(`  Jira:    ${secrets.jira ? "✓ configured" : "✗ not configured"}`);
        console.log(`\nAI:`);
        console.log(`  Anthropic: ${secrets.anthropic ? "✓ configured" : "✗ not configured"}`);
        console.log(`  Model:     ${config.ai.model}`);
        console.log(`\nPreferences:`);
        if (config.preferences.companyName) console.log(`  Company:  ${config.preferences.companyName}`);
        if (config.preferences.brandColor) console.log(`  Color:    ${config.preferences.brandColor}`);
        console.log(`  Template: ${config.preferences.defaultTemplate}`);
        console.log(`  Footer:   ${config.preferences.pageFooter ?? "disabled (default)"}`);
        console.log();
      });

    // list: list past releases
    program
      .command("list")
      .description("List past releases")
      .option("--project <name>", "Filter by project name")
      .action(async (options) => {
        const { listReleases } = await import("../dist/server/db/queries.js");
        const releases = listReleases({ projectName: options.project, limit: 20 });

        if (releases.length === 0) {
          console.log("\nNo releases yet. Run `shippage` to create your first one.\n");
          return;
        }

        console.log(`\nPast releases (${releases.length}):\n`);
        for (const r of releases) {
          const status = { draft: "○", published: "●", archived: "◌" }[r.status];
          console.log(`  ${status} ${r.projectName} ${r.version}  —  ${r.status}  (${r.id.slice(0, 8)})`);
        }
        console.log();
      });

    // export: export a release by ID
    program
      .command("export <id>")
      .description("Export a release to a static HTML file")
      .option("--mode <mode>", "Export mode: single-file or folder", "single-file")
      .action(async (id, options) => {
        const { getRelease } = await import("../dist/server/db/queries.js");
        const { exportRelease } = await import("../dist/server/services/html-exporter.js");

        const release = getRelease(id);
        if (!release) {
          // Try prefix match
          const { listReleases } = await import("../dist/server/db/queries.js");
          const all = listReleases({});
          const match = all.find((r) => r.id.startsWith(id));
          if (!match) {
            console.error(`\nRelease not found: ${id}\nRun \`shippage list\` to see available releases.\n`);
            process.exit(1);
          }
          id = match.id;
        }

        const finalRelease = getRelease(id);
        if (!finalRelease) { process.exit(1); }

        console.log(`\nExporting release ${finalRelease.projectName} ${finalRelease.version}...`);
        const result = await exportRelease(finalRelease, options.mode);
        console.log(`\n✓ Exported to: ${result.path}`);
        console.log(`  Size: ${Math.round(result.sizeBytes / 1024)}KB\n`);
      });

    program.parse();
  } catch (err) {
    console.error("\nShipPage failed to start:", err instanceof Error ? err.message : String(err));
    console.error("If this keeps happening, try running `pnpm build` first.\n");
    process.exit(1);
  }
}

async function checkFirstRun() {
  const fs = await import("fs");
  const os = await import("os");
  const path = await import("path");
  const shiPageDir = path.join(os.homedir(), ".shippage");
  const configPath = path.join(shiPageDir, "config.json");
  return !fs.existsSync(configPath);
}

async function runInit() {
  const { default: inquirer } = await import("inquirer");
  const { setSecret, writeConfig, ensureShipPageDirs, readConfig } = await import(
    "../dist/server/config/store.js"
  );
  const { linearClient } = await import("../dist/server/services/linear.js");
  const { githubClient } = await import("../dist/server/services/github.js");
  const { jiraClient } = await import("../dist/server/services/jira.js");
  const Anthropic = (await import("@anthropic-ai/sdk")).default;

  ensureShipPageDirs();

  console.log("─".repeat(50));
  console.log(" ShipPage Setup");
  console.log("─".repeat(50));
  console.log("\nThis wizard will configure your integrations.");
  console.log("Secrets are stored in your OS keychain (or ~/.shippage/config.json if keychain is unavailable).\n");

  const config = readConfig();

  // Step 1: Integrations
  const { integrations } = await inquirer.prompt([
    {
      type: "checkbox",
      name: "integrations",
      message: "Which integrations do you want to configure?",
      choices: ["Linear", "GitHub Issues", "Jira"],
    },
  ]);

  // Linear
  if (integrations.includes("Linear")) {
    const { linearPat } = await inquirer.prompt([
      {
        type: "password",
        name: "linearPat",
        message: "Linear Personal Access Token:",
        mask: "*",
        validate: (v) => v.length > 0 || "PAT cannot be empty",
      },
    ]);

    process.stdout.write("  Testing Linear connection... ");
    const result = await linearClient.testConnection(linearPat);
    if (result.ok) {
      console.log("✓");
      await setSecret("linearPat", linearPat);
      // Fetch teams for default selection
      try {
        const teams = await linearClient.fetchProjects(linearPat);
        if (teams.length > 0) {
          const { defaultTeam } = await inquirer.prompt([
            {
              type: "list",
              name: "defaultTeam",
              message: "Default Linear team:",
              choices: [{ name: "(no default)", value: "" }, ...teams.map((t) => ({ name: t.name, value: t.id }))],
            },
          ]);
          if (defaultTeam) {
            config.integrations.linear = { defaultTeamId: defaultTeam };
          }
        }
      } catch { /* skip if team fetch fails */ }
    } else {
      console.log(`✗ ${result.error ?? "Connection failed"}`);
      console.log("  Skipping Linear (you can reconfigure with `shippage init`).");
    }
  }

  // GitHub
  if (integrations.includes("GitHub Issues")) {
    const { githubPat, githubOwner } = await inquirer.prompt([
      {
        type: "password",
        name: "githubPat",
        message: "GitHub Personal Access Token (needs repo or public_repo scope):",
        mask: "*",
        validate: (v) => v.length > 0 || "PAT cannot be empty",
      },
      {
        type: "input",
        name: "githubOwner",
        message: "Default GitHub owner (username or org, optional):",
      },
    ]);

    process.stdout.write("  Testing GitHub connection... ");
    const result = await githubClient.testConnection(githubPat);
    if (result.ok) {
      console.log("✓");
      await setSecret("githubPat", githubPat);
      if (githubOwner) {
        config.integrations.github = { defaultOwner: githubOwner };
      }
    } else {
      console.log(`✗ ${result.error ?? "Connection failed"}`);
      console.log("  Skipping GitHub (you can reconfigure with `shippage init`).");
    }
  }

  // Jira
  if (integrations.includes("Jira")) {
    const jiraAnswers = await inquirer.prompt([
      {
        type: "list",
        name: "apiType",
        message: "Which Jira are you using?",
        choices: [
          { name: "Jira Cloud (atlassian.net)", value: "cloud" },
          { name: "Jira Server / Data Center (self-hosted)", value: "server" },
        ],
      },
      {
        type: "input",
        name: "baseUrl",
        message: "Jira base URL (e.g. https://mycompany.atlassian.net):",
        validate: (v) => v.startsWith("https://") || "Must be an HTTPS URL",
      },
      {
        type: "input",
        name: "email",
        message: "Your Jira email address:",
        validate: (v) => v.includes("@") || "Enter a valid email",
      },
      {
        type: "password",
        name: "jiraPat",
        message: (answers) =>
          answers.apiType === "cloud"
            ? "Jira API Token (from id.atlassian.com/manage-profile/security/api-tokens):"
            : "Jira Personal Access Token (from your Jira account settings):",
        mask: "*",
        validate: (v) => v.length > 0 || "Token cannot be empty",
      },
    ]);

    const jiraConfig = { baseUrl: jiraAnswers.baseUrl, email: jiraAnswers.email, apiType: jiraAnswers.apiType };
    process.stdout.write("  Testing Jira connection... ");
    const result = await jiraClient.testConnection(jiraConfig, jiraAnswers.jiraPat);
    if (result.ok) {
      console.log("✓");
      await setSecret("jiraPat", jiraAnswers.jiraPat);
      config.integrations.jira = jiraConfig;
    } else {
      console.log(`✗ ${result.error ?? "Connection failed"}`);
      console.log("  Skipping Jira (you can reconfigure with `shippage init`).");
    }
  }

  // Step 2: Anthropic API key
  const { anthropicKey } = await inquirer.prompt([
    {
      type: "password",
      name: "anthropicKey",
      message: "Anthropic API key (from console.anthropic.com):",
      mask: "*",
      validate: (v) => v.length > 0 || "API key cannot be empty",
    },
  ]);

  process.stdout.write("  Testing Anthropic connection... ");
  try {
    const client = new Anthropic({ apiKey: anthropicKey });
    await client.messages.create({
      model: config.ai.model,
      max_tokens: 10,
      messages: [{ role: "user", content: "Hi" }],
    });
    console.log("✓");
    await setSecret("anthropicKey", anthropicKey);
  } catch {
    console.log("✗ Could not verify API key. Saving anyway — check the key if generation fails.");
    await setSecret("anthropicKey", anthropicKey);
  }

  // Step 3: Preferences
  const prefs = await inquirer.prompt([
    {
      type: "input",
      name: "companyName",
      message: "Company or product name (optional, used in generated pages):",
    },
    {
      type: "input",
      name: "brandColor",
      message: "Brand color as hex (optional, e.g. #2563EB):",
      validate: (v) => !v || /^#[0-9A-Fa-f]{6}$/.test(v) || "Must be a valid hex color like #2563EB",
    },
    {
      type: "list",
      name: "defaultTemplate",
      message: "Default page template:",
      choices: [
        { name: "Minimal — clean, typography-focused", value: "minimal" },
        { name: "Changelog — structured with version badges", value: "changelog" },
        { name: "Feature Launch — marketing-style hero", value: "feature-launch" },
      ],
    },
  ]);

  if (prefs.companyName) config.preferences.companyName = prefs.companyName;
  if (prefs.brandColor) config.preferences.brandColor = prefs.brandColor;
  config.preferences.defaultTemplate = prefs.defaultTemplate;

  writeConfig(config);

  console.log("\n✓ Setup complete! Your config is saved to ~/.shippage/config.json (secrets in OS keychain).");
  console.log("  Run `shippage` to start.\n");
}

main();
