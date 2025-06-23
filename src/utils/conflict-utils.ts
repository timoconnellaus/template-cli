import { promises as fs, readFileSync } from 'fs';
import * as readline from 'readline';
import { spawn } from 'child_process';
import { resolve, join } from 'path';
import { reconstructStateFromMigrations } from './state-utils.js';
import { generateUnifiedDiff } from './diff-utils.js';

export interface ConflictResolution {
  action: 'keep' | 'template' | 'claude';
  content: string;
}

export async function resolveConflict(
  filePath: string,
  currentContent: string,
  diffContent: string,
  error: Error,
  templatePath: string = '.'
): Promise<ConflictResolution> {
  console.log('\n🔧 Merge Conflict Detected');
  console.log('='.repeat(50));
  console.log(`File: ${filePath}`);
  console.log(`Error: ${error.message}`);
  console.log('='.repeat(50));
  
  // Show the current content
  console.log('\n📄 Current Content:');
  console.log('-'.repeat(30));
  showContentPreview(currentContent);
  
  // Show the diff that failed to apply
  console.log('\n📝 Template Diff (failed to apply):');
  console.log('-'.repeat(30));
  showDiffPreview(diffContent);
  
  console.log('\n💡 How would you like to resolve this conflict?');
  console.log('1. Keep my version (current content)');
  console.log('2. Use template version (apply diff forcefully if possible)');
  console.log('3. Use Claude Code CLI to automatically merge both versions');
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    const choice = await askQuestion(rl, '\nEnter your choice (1, 2, or 3): ');
    
    if (choice === '1') {
      console.log('✅ Keeping your version');
      return {
        action: 'keep',
        content: currentContent
      };
    } else if (choice === '2') {
      console.log('✅ Using template version');
      const templateContent = await tryApplyDiffForcefully(currentContent, diffContent);
      return {
        action: 'template',
        content: templateContent
      };
    } else if (choice === '3') {
      console.log('🤖 Using Claude Code CLI to merge versions...');
      const claudeContent = await resolveWithClaude(filePath, currentContent, diffContent, templatePath);
      return {
        action: 'claude',
        content: claudeContent
      };
    } else {
      console.log('❌ Invalid choice. Keeping your version by default.');
      return {
        action: 'keep',
        content: currentContent
      };
    }
  } finally {
    rl.close();
  }
}

function showContentPreview(content: string, maxLines: number = 10): void {
  const lines = content.split('\n');
  if (lines.length <= maxLines) {
    console.log(content);
  } else {
    console.log(lines.slice(0, maxLines).join('\n'));
    console.log(`... (${lines.length - maxLines} more lines)`);
  }
}

function showDiffPreview(diffContent: string, maxLines: number = 20): void {
  const lines = diffContent.split('\n');
  if (lines.length <= maxLines) {
    console.log(diffContent);
  } else {
    console.log(lines.slice(0, maxLines).join('\n'));
    console.log(`... (${lines.length - maxLines} more lines)`);
  }
}

async function tryApplyDiffForcefully(currentContent: string, diffContent: string): string {
  // Try to extract the target content from the diff
  // This is a simple approach - for a more robust solution, we could:
  // 1. Try fuzzy matching
  // 2. Apply only the additions
  // 3. Use a more sophisticated merge algorithm
  
  const lines = diffContent.split('\n');
  const result: string[] = [];
  
  let inHunk = false;
  
  for (const line of lines) {
    if (line.startsWith('@@')) {
      inHunk = true;
      continue;
    }
    
    if (line.startsWith('---') || line.startsWith('+++')) {
      continue;
    }
    
    if (inHunk) {
      if (line.startsWith('+')) {
        // Add the new line (without the +)
        result.push(line.substring(1));
      } else if (line.startsWith(' ')) {
        // Keep context line (without the space)
        result.push(line.substring(1));
      }
      // Skip lines that start with '-' (deletions)
    }
  }
  
  // If we couldn't extract meaningful content, return current content
  if (result.length === 0) {
    console.log('⚠️  Could not extract template content from diff. Keeping current content.');
    return currentContent;
  }
  
  return result.join('\n');
}

function askQuestion(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

export async function calculateUserDiff(
  filePath: string,
  currentContent: string,
  templatePath: string = '.'
): Promise<string | null> {
  try {
    // Reconstruct the baseline state from all applied migrations
    const migrationsPath = templatePath === '.' ? 'migrations' : join(templatePath, 'migrations');
    const baselineState = await reconstructStateFromMigrations(migrationsPath);
    
    // If we couldn't reconstruct any baseline state, treat file as user-created
    if (!baselineState || Object.keys(baselineState).length === 0) {
      // No migrations have been applied or migrations directory doesn't exist
      // In this case, any file content is considered user-created
      return generateUnifiedDiff('', currentContent, '/dev/null', filePath);
    }
    
    // Get the baseline content for this file (what it looked like after all migrations but before user changes)
    const baselineContent = baselineState[filePath];
    
    // If the file doesn't exist in baseline, it means it was user-created
    if (baselineContent === undefined) {
      // This is a new file created by the user
      return generateUnifiedDiff('', currentContent, '/dev/null', filePath);
    }
    
    // If baseline and current are the same, no user changes
    if (baselineContent === currentContent) {
      return null;
    }
    
    // Generate diff from baseline to current (user changes)
    return generateUnifiedDiff(baselineContent, currentContent, `${filePath}.baseline`, filePath);
  } catch (error) {
    console.warn(`⚠️  Could not calculate user diff for ${filePath}:`, error instanceof Error ? error.message : String(error));
    // If we can't calculate the baseline, treat as user-created
    return generateUnifiedDiff('', currentContent, '/dev/null', filePath);
  }
}

interface ClaudeCliResponse {
  type: string;
  subtype: string;
  total_cost_usd: number;
  is_error: boolean;
  duration_ms: number;
  duration_api_ms: number;
  num_turns: number;
  result: string;
  session_id: string;
}

async function resolveWithClaude(
  filePath: string,
  currentContent: string,
  diffContent: string,
  templatePath: string = '.'
): Promise<string> {
  // Get the absolute path for the file
  const absolutePath = resolve(filePath);
  
  // Calculate the user's diff to understand what they changed
  const userDiff = await calculateUserDiff(filePath, currentContent, templatePath);
  
  let prompt = `You need to resolve a merge conflict during a template migration by editing a file.

TASK: Edit the file at ${absolutePath} to intelligently merge template changes with user modifications.

CURRENT SITUATION:
- A template diff failed to apply due to conflicts with user changes
- You have both the user's changes and the template's intended changes
- You need to merge both sets of changes intelligently

CURRENT FILE CONTENT:
\`\`\`
${currentContent}
\`\`\`

TEMPLATE DIFF (what the template wants to change):
\`\`\`
${diffContent}
\`\`\``;

  if (userDiff) {
    prompt += `

USER DIFF (what the user changed from the baseline):
\`\`\`
${userDiff}
\`\`\`

CONTEXT:
- The USER DIFF shows what the user intentionally modified from the template baseline
- The TEMPLATE DIFF shows what the template is trying to update
- Both changes are legitimate and should be preserved where possible`;
  } else {
    prompt += `

NOTE: No user changes were detected from the baseline state. The conflict may be due to the template trying to modify a file that has already been changed by previous template updates.`;
  }

  prompt += `

INSTRUCTIONS:
1. Use the Edit tool to update the file at ${absolutePath}
2. PRESERVE user customizations and changes wherever possible
3. APPLY template updates where they don't conflict with user changes
4. For areas where both user and template made changes to the same lines:
   - Try to merge both changes if they're compatible
   - If incompatible, prefer the user's changes but add template changes as comments
   - Add clear comments explaining any manual resolution needed
5. Ensure the final file is syntactically correct and functional
6. The goal is to maintain user's intent while incorporating template improvements

Please edit the file now to create an intelligent merge that respects both the user's customizations and the template's improvements.`;

  // Show spinner
  const spinnerChars = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let spinnerIndex = 0;
  
  const spinnerInterval = setInterval(() => {
    process.stdout.write(`\r${spinnerChars[spinnerIndex]} Running Claude Code CLI...`);
    spinnerIndex = (spinnerIndex + 1) % spinnerChars.length;
  }, 100);

  try {
    const result = await runClaudeCli(prompt);
    clearInterval(spinnerInterval);
    process.stdout.write('\r✅ Claude Code CLI completed successfully\n');
    
    if (result.is_error) {
      throw new Error(`Claude CLI error: ${result.result}`);
    }
    
    // Since Claude Code edited the file directly, read the updated content
    const absolutePath = resolve(filePath);
    
    try {
      const updatedContent = readFileSync(absolutePath, 'utf8');
      return updatedContent;
    } catch (readError) {
      console.error('Error reading updated file:', readError instanceof Error ? readError.message : String(readError));
      console.log('Falling back to keeping your version...');
      return currentContent;
    }
  } catch (error) {
    clearInterval(spinnerInterval);
    process.stdout.write('\r❌ Claude Code CLI failed\n');
    console.error('Error running Claude CLI:', error instanceof Error ? error.message : String(error));
    console.log('Falling back to keeping your version...');
    return currentContent;
  }
}

function runClaudeCli(prompt: string): Promise<ClaudeCliResponse> {
  return new Promise((resolve, reject) => {
    // Use the full path to the claude binary to avoid alias/PATH issues
    const claudePath = `${process.env.HOME}/.claude/local/claude`;
    
    const child = spawn(claudePath, ['-p', prompt, '--output-format', 'stream-json', '--verbose'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        SHELL: '/bin/bash'
      }
    });

    let buffer = '';
    let stderr = '';
    let isResolved = false;
    let resultMessage: ClaudeCliResponse | null = null;

    // Add timeout to prevent hanging
    const timeout = setTimeout(() => {
      if (!isResolved) {
        child.kill('SIGTERM');
        reject(new Error('Claude CLI timed out after 60 seconds'));
      }
    }, 60000);

    child.stdout.on('data', (data) => {
      const rawData = data.toString();
      buffer += rawData;
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.trim()) {
          try {
            const parsed = JSON.parse(line);
            
            // Look for the final result message
            if (parsed.type === 'result') {
              console.log('\n🏆 CLAUDE FINAL RESULT:');
              console.log('-'.repeat(80));
              console.log(parsed.result || 'No result content');
              console.log('-'.repeat(80));
              
              resultMessage = parsed as ClaudeCliResponse;
              // Don't resolve yet - wait for process to close
            }
          } catch (error) {
            // Ignore JSON parsing errors for individual lines
            // Some lines might not be complete JSON
          }
        }
      }
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      if (isResolved) return;
      isResolved = true;
      clearTimeout(timeout);

      if (code !== 0) {
        reject(new Error(`Claude CLI exited with code ${code}: ${stderr}`));
        return;
      }

      if (resultMessage) {
        resolve(resultMessage);
      } else {
        reject(new Error('No result message received from Claude CLI'));
      }
    });

    child.on('error', (error) => {
      if (isResolved) return;
      isResolved = true;
      clearTimeout(timeout);
      reject(new Error(`Failed to spawn Claude CLI: ${error.message}`));
    });

    // Close stdin to ensure Claude doesn't wait for input
    child.stdin.end();
  });
}