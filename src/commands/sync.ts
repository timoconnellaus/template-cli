import { existsSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { simpleGit, type SimpleGit } from "simple-git";
import confirm from "@inquirer/confirm";
import { select } from "@inquirer/prompts";
import type { AppliedMigrationsFile } from "../utils/migration-utils.js";
import { getAllMigrationDirectories, reconstructStateIncrementally } from "../utils/state-utils.js";
import { getCurrentState, loadIgnorePatterns, isBinaryFile } from "../utils/file-utils.js";
import { calculateSimilarity, findBestMatch, formatSimilarityScore, type SimilarityScore } from "../utils/similarity-utils.js";
import { callClaudeToMergeFile } from "../utils/claude-cli.js";
import { calculateUserDiff } from "../utils/conflict-utils.js";
import { ensureDirectoryExists } from "../utils/file-utils.js";

/**
 * Check if content appears to be binary based on content analysis
 */
function isBinaryContent(content: string): boolean {
  // Check for null bytes (common binary indicator)
  if (content.includes('\0')) {
    return true;
  }
  
  // Check for high percentage of non-printable characters
  let nonPrintableCount = 0;
  for (let i = 0; i < Math.min(content.length, 8000); i++) {
    const charCode = content.charCodeAt(i);
    // Non-printable characters (excluding common whitespace)
    if (charCode < 32 && charCode !== 9 && charCode !== 10 && charCode !== 13) {
      nonPrintableCount++;
    }
  }
  
  // If more than 30% non-printable, likely binary
  return (nonPrintableCount / Math.min(content.length, 8000)) > 0.3;
}

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
    
    if (isBinaryContent(fileContent)) {
      // Binary file - show size and type info instead of content
      const sizeInBytes = Buffer.byteLength(fileContent, 'utf8');
      const fileExtension = filePath.split('.').pop()?.toLowerCase() || 'unknown';
      console.log(`📊 Binary file (${fileExtension.toUpperCase()}) - ${sizeInBytes} bytes`);
      console.log('⚠️  Binary content cannot be previewed');
    } else {
      // Text file - show content preview
      const lines = fileContent.split('\n');
      if (lines.length > 10) {
        console.log('Preview (first 10 lines):');
        console.log(lines.slice(0, 10).join('\n'));
        console.log(`... (${lines.length - 10} more lines)`);
      } else {
        console.log('Content:');
        console.log(fileContent);
      }
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
        
        if (isBinaryContent(fileContent)) {
          // For binary files, write as binary data
          const buffer = Buffer.from(fileContent, 'binary');
          writeFileSync(targetFilePath, buffer);
        } else {
          // For text files, write as text
          writeFileSync(targetFilePath, fileContent);
        }
        
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
    
    // Check if either version is binary
    const userIsBinary = isBinaryContent(userContent);
    const templateIsBinary = isBinaryContent(templateContent);
    
    // Split content into lines for text files (needed for merge functionality)
    let userLines: string[] = [];
    let templateLines: string[] = [];
    
    if (userIsBinary || templateIsBinary) {
      // Binary file - show size comparison instead of line count
      console.log('\n📊 Binary file differences detected:');
      const userSize = Buffer.byteLength(userContent, 'utf8');
      const templateSize = Buffer.byteLength(templateContent, 'utf8');
      const fileExtension = filePath.split('.').pop()?.toLowerCase() || 'unknown';
      
      console.log(`Your version: ${userSize} bytes (${fileExtension.toUpperCase()})`);
      console.log(`Template version: ${templateSize} bytes (${fileExtension.toUpperCase()})`);
      console.log('⚠️  Binary files cannot be merged automatically');
    } else {
      // Text file - show line count differences
      console.log('\n📊 Differences detected:');
      userLines = userContent.split('\n');
      templateLines = templateContent.split('\n');
      
      console.log(`Your version: ${userLines.length} lines`);
      console.log(`Template version: ${templateLines.length} lines`);
    }
    
    // Create choices based on whether file is binary
    const choices = [
      { name: 'Replace with template version', value: 'replace' },
      { name: 'Skip (keep my version)', value: 'skip' }
    ];
    
    // Only add merge option for text files
    if (!userIsBinary && !templateIsBinary) {
      choices.push({ name: 'Use Claude Code to intelligently merge both versions', value: 'merge' });
    }
    
    const choice = await select({
      message: `How would you like to handle ${filePath}?`,
      choices: choices
    });

    if (choice === 'replace') {
      try {
        const targetFilePath = join(targetPath, filePath);
        
        if (templateIsBinary) {
          // For binary files, write as binary data
          const buffer = Buffer.from(templateContent, 'binary');
          writeFileSync(targetFilePath, buffer);
        } else {
          // For text files, write as text
          writeFileSync(targetFilePath, templateContent);
        }
        
        console.log(`✅ Replaced ${filePath} with template version`);
      } catch (error) {
        console.error(`❌ Failed to replace ${filePath}:`, error instanceof Error ? error.message : String(error));
      }
    } else if (choice === 'skip') {
      console.log(`⏭️  Kept your version of ${filePath}`);
    } else if (choice === 'merge') {
      try {
        // Create a mock diff to represent template changes
        const mockDiff = `--- a/${filePath}\n+++ b/${filePath}\n@@ -1,${userLines.length} +1,${templateLines.length} @@\n${templateLines.map(line => `+${line}`).join('\n')}`;
        
        // Calculate user diff from baseline
        const userDiff = await calculateUserDiff(filePath, userContent, templatePath);
        
        // Use Claude CLI to merge both versions
        const mergedContent = await callClaudeToMergeFile(filePath, userContent, mockDiff, userDiff, templatePath);
        
        const targetFilePath = join(targetPath, filePath);
        await writeFileSync(targetFilePath, mergedContent);
        
        console.log(`🤖 Claude Code merged ${filePath}`);
      } catch (error) {
        console.error(`❌ Failed to merge ${filePath}:`, error instanceof Error ? error.message : String(error));
        console.log(`⏭️  Keeping your version of ${filePath}`);
      }
    }
  }
}