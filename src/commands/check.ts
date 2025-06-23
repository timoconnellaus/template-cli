import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { simpleGit, type SimpleGit } from "simple-git";
import type { AppliedMigrationsFile } from "../utils/migration-utils.js";
import { getAllMigrationDirectories, type MigrationInfo } from "../utils/state-utils.js";

/**
 * Check for pending migrations that haven't been applied yet
 */
export async function checkPendingMigrations(targetPath: string): Promise<void> {
  const appliedMigrationsPath = join(targetPath, "applied-migrations.json");
  
  if (!existsSync(appliedMigrationsPath)) {
    console.log("❌ No applied-migrations.json found. Run 'init' first to initialize from a template.");
    return;
  }

  const appliedMigrationsData: AppliedMigrationsFile = JSON.parse(
    readFileSync(appliedMigrationsPath, "utf-8")
  );

  const templatePath = appliedMigrationsData.template;
  
  if (!existsSync(templatePath)) {
    console.log(`❌ Template path not found: ${templatePath}`);
    return;
  }

  // Get all available migrations from template
  const allMigrations = getAllMigrationDirectories(templatePath);
  
  // Get applied migration names
  const appliedMigrationNames = new Set(
    appliedMigrationsData.appliedMigrations.map(m => m.name)
  );

  // Find pending migrations
  const pendingMigrations = allMigrations.filter(
    migration => !appliedMigrationNames.has(migration.name)
  );

  if (pendingMigrations.length === 0) {
    console.log("✅ No pending migrations found. You are up to date!");
    return;
  }

  console.log(`📋 Found ${pendingMigrations.length} pending migration(s):`);
  pendingMigrations.forEach(migration => {
    console.log(`  - ${migration.name} (${migration.timestamp})`);
  });

  // Check if template has newer commits
  try {
    const git: SimpleGit = simpleGit(templatePath);
    const status = await git.status();
    
    if (status.behind > 0) {
      console.log(`\n⚠️  Template repository is ${status.behind} commit(s) behind origin.`);
      console.log("   Consider running 'git pull' in the template directory first.");
    }
  } catch (error) {
    // Ignore git errors - template might not be a git repository
  }

  console.log("\n💡 Run 'update' to apply pending migrations.");
}