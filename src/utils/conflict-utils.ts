import { promises as fs } from 'fs';
import * as readline from 'readline';

export interface ConflictResolution {
  action: 'keep' | 'template';
  content: string;
}

export async function resolveConflict(
  filePath: string,
  currentContent: string,
  diffContent: string,
  error: Error
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
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    const choice = await askQuestion(rl, '\nEnter your choice (1 or 2): ');
    
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