#!/usr/bin/env node

import { Command } from "commander";
import { generateMigration } from "./src/commands/generate";
import { initializeFromTemplate } from "./src/commands/init";
import { checkPendingMigrations } from "./src/commands/check";
import { updateFromTemplate } from "./src/commands/update";
import { syncWithTemplate } from "./src/commands/sync";
import { checkForUpdates, getCurrentVersion } from "./src/utils/version-utils";

const program = new Command();

// Check for updates in the background (non-blocking)
checkForUpdates().catch(() => {
  // Silently ignore update check failures
});

program.name("template-cli").description("Template-based project initialization and synchronization with intelligent migration tracking").version(getCurrentVersion());

// Template user commands (top-level)
program
  .command("init <target>")
  .description("Initialize a new project from template")
  .option("-t, --template <path>", "Path to template directory", process.cwd())
  .action(async (target, options) => {
    try {
      await initializeFromTemplate(options.template, target);
    } catch (error) {
      console.error("❌ Error initializing project:", error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program
  .command("check")
  .description("Check for pending migrations from template")
  .option("-p, --path <path>", "Path to check for migrations", process.cwd())
  .action(async (options) => {
    try {
      await checkPendingMigrations(options.path);
    } catch (error) {
      console.error("❌ Error checking migrations:", error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program
  .command("update")
  .description("Apply pending migrations from template")
  .option("-p, --path <path>", "Path to update with migrations", process.cwd())
  .action(async (options) => {
    try {
      await updateFromTemplate(options.path);
    } catch (error) {
      console.error("❌ Error updating from template:", error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program
  .command("sync")
  .description("Sync existing repository with template using historical reconstruction")
  .requiredOption("-t, --template <path>", "Path to template directory")
  .option("-p, --path <path>", "Path to repository to sync", process.cwd())
  .action(async (options) => {
    try {
      await syncWithTemplate(options.template, options.path);
    } catch (error) {
      console.error("❌ Error syncing with template:", error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// Template developer commands (under dev)
const devCommand = program.command("dev").description("Template development commands");

devCommand
  .command("generate [name]")
  .description(
    "Generate migration files based on current state vs last migration"
  )
  .option("-p, --path <path>", "Path to generate migrations in", process.cwd())
  .action(async (name, options) => {
    try {
      await generateMigration(options.path, name);
    } catch (error) {
      console.error("❌ Error generating migration:", error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program.parse();