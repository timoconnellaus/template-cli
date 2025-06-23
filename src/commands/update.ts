import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { simpleGit, type SimpleGit } from "simple-git";
import type { AppliedMigrationsFile } from "../utils/migration-utils.js";
import { getAllMigrationDirectories, type MigrationInfo } from "../utils/state-utils.js";
import { applyMigration } from "../utils/template-utils.js";

/**
 * Apply pending migrations from the template
 */
export async function updateFromTemplate(targetPath: string): Promise<void> {
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
    console.log("✅ No pending migrations found. You are already up to date!");
    return;
  }

  console.log(`🔄 Applying ${pendingMigrations.length} pending migration(s)...`);

  // Apply each pending migration
  let appliedCount = 0;
  for (const migration of pendingMigrations) {
    try {
      console.log(`  Applying: ${migration.name}`);
      
      await applyMigration(
        templatePath,
        targetPath,
        migration.name
      );

      // Add to applied migrations
      appliedMigrationsData.appliedMigrations.push({
        name: migration.name,
        timestamp: migration.timestamp,
        appliedAt: new Date().toISOString()
      });

      appliedCount++;
      console.log(`  ✅ Applied: ${migration.name}`);
      
    } catch (error) {
      console.error(`  ❌ Failed to apply migration ${migration.name}:`, error.message);
      break; // Stop on first error to maintain consistency
    }
  }

  if (appliedCount > 0) {
    // Update applied-migrations.json
    writeFileSync(
      appliedMigrationsPath,
      JSON.stringify(appliedMigrationsData, null, 2)
    );
    
    console.log(`\n🎉 Successfully applied ${appliedCount} migration(s).`);
    
    if (appliedCount < pendingMigrations.length) {
      console.log(`⚠️  ${pendingMigrations.length - appliedCount} migration(s) failed to apply.`);
      console.log("   Fix any conflicts and run 'update' again.");
    }
  }

  // Check git status if this is a git repository
  try {
    const git: SimpleGit = simpleGit(targetPath);
    const status = await git.status();
    
    if (status.files.length > 0) {
      console.log("\n📝 Changes have been made to your project:");
      status.files.forEach(file => {
        const statusChar = file.index === ' ' ? file.working_dir : file.index;
        console.log(`  ${statusChar} ${file.path}`);
      });
      console.log("\n💡 Review the changes and commit them when ready.");
    }
  } catch (error) {
    // Ignore git errors - target might not be a git repository
  }
}