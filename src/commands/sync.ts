import { existsSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { simpleGit, type SimpleGit } from "simple-git";
import confirm from "@inquirer/confirm";
import { select } from "@inquirer/prompts";
import type { AppliedMigrationsFile } from "../utils/migration-utils.js";
import { getAllMigrationDirectories, reconstructStateIncrementally } from "../utils/state-utils.js";
import { getCurrentState, loadIgnorePatterns } from "../utils/file-utils.js";
import { calculateSimilarity, findBestMatch, formatSimilarityScore, type SimilarityScore } from "../utils/similarity-utils.js";
import { resolveConflict } from "../utils/conflict-utils.js";
import { ensureDirectoryExists } from "../utils/file-utils.js";

/**
 * Sync repository with template using historical reconstruction
 */
export async function syncWithTemplate(templatePath: string, targetPath: string = process.cwd()): Promise<void> {
  console.log("🔍 Analyzing your repository...");
  
  // Check if already has migration tracking
  const appliedMigrationsPath = join(targetPath, "applied-migrations.json");
  if (existsSync(appliedMigrationsPath)) {
    console.log("❌ Repository already has migration tracking. Use 'update' command instead.");
    return;
  }
  
  // Validate template exists
  if (!existsSync(templatePath)) {
    console.log(`❌ Template path not found: ${templatePath}`);
    return;
  }
  
  // Check if template has migrations
  const migrationsPath = join(templatePath, "migrations");
  if (!existsSync(migrationsPath)) {
    console.log("❌ Template has no migrations directory. Use 'init' command instead.");
    return;
  }
  
  // Get all available migrations from template
  const allMigrations = getAllMigrationDirectories(templatePath);
  if (allMigrations.length === 0) {
    console.log("❌ Template has no migrations. Use 'init' command instead.");
    return;
  }
  
  console.log("No applied-migrations.json found. Analyzing against template history...");
  
  // Load ignore patterns and scan user repository
  const ignorePatterns = await loadIgnorePatterns(targetPath);
  const userState = await getCurrentState(targetPath, ignorePatterns);
  
  if (Object.keys(userState).length === 0) {
    console.log("❌ Your repository appears to be empty. Use 'init' command instead.");
    return;
  }
  
  // Calculate similarity scores for each migration point
  console.log("📊 Calculating similarity scores...");
  const scores: SimilarityScore[] = [];
  
  // Reconstruct all historical states incrementally
  const historicalStates = await reconstructStateIncrementally(migrationsPath);
  
  // Test against each historical state
  for (const [stateName, templateState] of historicalStates) {
    try {
      // For initial state, use empty timestamp
      const timestamp = stateName === 'initial-state' ? '' : allMigrations.find(m => m.name === stateName)?.timestamp || '';
      const score = calculateSimilarity(userState, templateState, stateName, timestamp);
      scores.push(score);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn(`⚠️  Could not analyze state ${stateName}: ${errorMessage}`);
    }
  }
  
  // Find the best match
  const bestMatch = findBestMatch(scores);
  
  if (!bestMatch) {
    console.log("❌ Could not find a good match with the template history.");
    console.log("   Your repository may be too different from the template.");
    console.log("   Consider using 'init' to start fresh or manually create applied-migrations.json");
    return;
  }
  
  // Display analysis results
  console.log("\n📊 Similarity Analysis Results:");
  console.log(`✅ Best match found: "${bestMatch.migrationName}"`);
  console.log(formatSimilarityScore(bestMatch));
  
  // Show top 3 matches for context
  const topMatches = scores.sort((a, b) => b.score - a.score).slice(0, 3);
  if (topMatches.length > 1) {
    console.log("\n📈 Other potential matches:");
    topMatches.slice(1).forEach(score => {
      console.log(formatSimilarityScore(score));
    });
  }
  
  // Calculate how many newer migrations would be available
  const bestMatchIndex = allMigrations.findIndex(m => m.name === bestMatch.migrationName);
  const newerMigrations = bestMatchIndex >= 0 ? allMigrations.slice(bestMatchIndex + 1) : allMigrations;
  
  console.log(`\n🔄 After synchronization:`);
  if (bestMatch.migrationName === "initial-state") {
    console.log(`   - All ${allMigrations.length} migrations will be available to apply`);
  } else {
    console.log(`   - ${newerMigrations.length} newer migrations will be available to apply`);
  }
  
  // Handle missing and similar files interactively
  await handleMissingFiles(bestMatch, historicalStates, targetPath, templatePath);
  await handleSimilarFiles(bestMatch, historicalStates, userState, targetPath, templatePath);
  
  // Ask for confirmation
  console.log(`\n❓ Proceed with synchronization? This will:`);
  console.log(`   1. Create applied-migrations.json marking this sync point`);
  console.log(`   2. Make ${newerMigrations.length} migration(s) available for update`);
  
  const shouldProceed = await confirm({
    message: "Continue?",
    default: false
  });
  
  if (!shouldProceed) {
    console.log("❌ Synchronization cancelled.");
    return;
  }
  
  // Create applied-migrations.json
  const appliedMigrations: AppliedMigrationsFile = {
    version: "1.0.0",
    template: templatePath,
    appliedMigrations: []
  };
  
  // Add all migrations up to the best match (if not initial state)
  if (bestMatch.migrationName !== "initial-state") {
    const matchIndex = allMigrations.findIndex(m => m.name === bestMatch.migrationName);
    const appliedMigrationsList = allMigrations.slice(0, matchIndex + 1);
    
    appliedMigrations.appliedMigrations = appliedMigrationsList.map(migration => ({
      name: migration.name,
      timestamp: migration.timestamp,
      appliedAt: new Date().toISOString()
    }));
  }
  
  // Write the applied-migrations.json file
  writeFileSync(
    appliedMigrationsPath,
    JSON.stringify(appliedMigrations, null, 2)
  );
  
  console.log("✅ Sync complete!");
  console.log(`📝 Created applied-migrations.json with ${appliedMigrations.appliedMigrations.length} applied migration(s)`);
  
  if (newerMigrations.length > 0) {
    console.log(`🔄 Run "bun run dev update" to apply ${newerMigrations.length} pending migration(s)`);
  } else {
    console.log("🎉 Your repository is already up to date with the template!");
  }
  
  // Show git status if available
  try {
    const git: SimpleGit = simpleGit(targetPath);
    const status = await git.status();
    
    if (status.files.length > 0) {
      console.log("\n📝 Note: You have uncommitted changes:");
      status.files.forEach(file => {
        const statusChar = file.index === ' ' ? file.working_dir : file.index;
        console.log(`  ${statusChar} ${file.path}`);
      });
      console.log("💡 Consider committing these changes before running update.");
    }
  } catch (error) {
    // Ignore git errors - target might not be a git repository
  }
}

/**
 * Handle missing files interactively - ask user to add or skip each one
 */
async function handleMissingFiles(
  bestMatch: SimilarityScore,
  historicalStates: Map<string, Record<string, string>>,
  targetPath: string,
  templatePath: string
): Promise<void> {
  if (bestMatch.missingFiles.length === 0) {
    return;
  }

  console.log(`\n📋 Found ${bestMatch.missingFiles.length} missing files from the template:`);
  
  const templateState = historicalStates.get(bestMatch.migrationName);
  if (!templateState) {
    return;
  }

  for (const filePath of bestMatch.missingFiles) {
    console.log(`\n📄 Missing file: ${filePath}`);
    
    // Show preview of file content
    const fileContent = templateState[filePath] || '';
    const lines = fileContent.split('\n');
    if (lines.length > 10) {
      console.log('Preview (first 10 lines):');
      console.log(lines.slice(0, 10).join('\n'));
      console.log(`... (${lines.length - 10} more lines)`);
    } else {
      console.log('Content:');
      console.log(fileContent);
    }

    const choice = await select({
      message: `What would you like to do with ${filePath}?`,
      choices: [
        { name: 'Add this file to my repository', value: 'add' },
        { name: 'Skip this file', value: 'skip' }
      ]
    });

    if (choice === 'add') {
      try {
        const targetFilePath = join(targetPath, filePath);
        await ensureDirectoryExists(dirname(targetFilePath));
        await writeFileSync(targetFilePath, fileContent);
        console.log(`✅ Added ${filePath}`);
      } catch (error) {
        console.error(`❌ Failed to add ${filePath}:`, error instanceof Error ? error.message : String(error));
      }
    } else {
      console.log(`⏭️  Skipped ${filePath}`);
    }
  }
}

/**
 * Handle similar files interactively - ask user to replace, skip, or merge with Claude Code
 */
async function handleSimilarFiles(
  bestMatch: SimilarityScore,
  historicalStates: Map<string, Record<string, string>>,
  userState: Record<string, string>,
  targetPath: string,
  templatePath: string
): Promise<void> {
  if (bestMatch.partialMatches.length === 0) {
    return;
  }

  console.log(`\n🔄 Found ${bestMatch.partialMatches.length} files with differences:`);
  
  const templateState = historicalStates.get(bestMatch.migrationName);
  if (!templateState) {
    return;
  }

  for (const filePath of bestMatch.partialMatches) {
    console.log(`\n📝 File with differences: ${filePath}`);
    
    const userContent = userState[filePath] || '';
    const templateContent = templateState[filePath] || '';
    
    // Show diff preview
    console.log('\n📊 Differences detected:');
    const userLines = userContent.split('\n');
    const templateLines = templateContent.split('\n');
    
    console.log(`Your version: ${userLines.length} lines`);
    console.log(`Template version: ${templateLines.length} lines`);
    
    const choice = await select({
      message: `How would you like to handle ${filePath}?`,
      choices: [
        { name: 'Replace with template version', value: 'replace' },
        { name: 'Skip (keep my version)', value: 'skip' },
        { name: 'Use Claude Code to intelligently merge both versions', value: 'merge' }
      ]
    });

    if (choice === 'replace') {
      try {
        const targetFilePath = join(targetPath, filePath);
        await writeFileSync(targetFilePath, templateContent);
        console.log(`✅ Replaced ${filePath} with template version`);
      } catch (error) {
        console.error(`❌ Failed to replace ${filePath}:`, error instanceof Error ? error.message : String(error));
      }
    } else if (choice === 'skip') {
      console.log(`⏭️  Kept your version of ${filePath}`);
    } else if (choice === 'merge') {
      try {
        // Create a mock diff to use with the conflict resolution
        const mockDiff = `--- a/${filePath}\n+++ b/${filePath}\n@@ -1,${userLines.length} +1,${templateLines.length} @@\n${templateLines.map(line => `+${line}`).join('\n')}`;
        const mockError = new Error('Simulated conflict for merge');
        
        const resolution = await resolveConflict(filePath, userContent, mockDiff, mockError, templatePath);
        
        const targetFilePath = join(targetPath, filePath);
        await writeFileSync(targetFilePath, resolution.content);
        
        if (resolution.action === 'claude') {
          console.log(`🤖 Claude Code merged ${filePath}`);
        } else {
          console.log(`✅ Applied resolution for ${filePath}`);
        }
      } catch (error) {
        console.error(`❌ Failed to merge ${filePath}:`, error instanceof Error ? error.message : String(error));
        console.log(`⏭️  Keeping your version of ${filePath}`);
      }
    }
  }
}