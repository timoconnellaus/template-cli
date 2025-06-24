import { spawn } from "child_process";
import { readFileSync } from "fs";
import { resolve } from "path";

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

/**
 * Call Claude CLI to intelligently merge file conflicts
 */
export async function callClaudeToMergeFile(
  filePath: string,
  currentContent: string,
  templateDiff: string,
  userDiff: string | null,
  templatePath: string = "."
): Promise<string> {
  const absolutePath = resolve(filePath);

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
${templateDiff}
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

  // Show spinner with progress feedback
  const spinnerChars = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let spinnerIndex = 0;
  let stepCount = 0;

  const spinnerInterval = setInterval(() => {
    const stepText = stepCount > 0 ? ` (${stepCount} steps)` : "";
    process.stdout.write(
      `\r${spinnerChars[spinnerIndex]} Running Claude Code CLI...${stepText}`
    );
    spinnerIndex = (spinnerIndex + 1) % spinnerChars.length;
  }, 100);

  try {
    const result = await runClaudeCli(prompt, (newStepCount) => {
      stepCount = newStepCount;
    });
    clearInterval(spinnerInterval);
    process.stdout.write("\r✅ Claude Code CLI completed successfully\n");

    if (result.is_error) {
      throw new Error(`Claude CLI error: ${result.result}`);
    }

    // Since Claude Code edited the file directly, read the updated content
    try {
      const updatedContent = readFileSync(absolutePath, "utf8");
      return updatedContent;
    } catch (readError) {
      console.error(
        "Error reading updated file:",
        readError instanceof Error ? readError.message : String(readError)
      );
      console.log("Falling back to keeping your version...");
      return currentContent;
    }
  } catch (error) {
    clearInterval(spinnerInterval);
    process.stdout.write("\r❌ Claude Code CLI failed\n");
    console.error(
      "Error running Claude CLI:",
      error instanceof Error ? error.message : String(error)
    );
    console.log("Falling back to keeping your version...");
    return currentContent;
  }
}

function runClaudeCli(
  prompt: string,
  onStepUpdate?: (stepCount: number) => void
): Promise<ClaudeCliResponse> {
  return new Promise((resolve, reject) => {
    // Use the full path to the claude binary to avoid alias/PATH issues
    const claudePath = `${process.env.HOME}/.claude/local/claude`;

    const child = spawn(
      claudePath,
      [
        "-p",
        prompt,
        "--output-format",
        "stream-json",
        "--verbose",
        "--allowedTools",
        "Edit",
      ],
      {
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          SHELL: "/bin/bash",
        },
      }
    );

    let buffer = "";
    let stderr = "";
    let isResolved = false;
    let resultMessage: ClaudeCliResponse | null = null;
    let stepCount = 0;

    // Add timeout to prevent hanging (5 minutes)
    const timeout = setTimeout(() => {
      if (!isResolved) {
        child.kill("SIGTERM");
        reject(new Error("Claude CLI timed out after 5 minutes"));
      }
    }, 300000);

    child.stdout.on("data", (data) => {
      const rawData = data.toString();
      buffer += rawData;
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.trim()) {
          try {
            const parsed = JSON.parse(line);

            // Debug: Log all message types to understand the stream format
            if (process.env.DEBUG_CLAUDE_CLI) {
              console.log(`DEBUG CLAUDE STREAM: ${JSON.stringify(parsed)}`);
            }

            // Count steps for progress feedback based on claude-code-discord implementation
            // Track meaningful messages that indicate progress
            if (
              parsed.type === "assistant" ||
              parsed.type === "user" ||
              (parsed.type === "assistant" && parsed.message?.content?.some((c: any) => c.type === "tool_use")) ||
              (parsed.type === "user" && parsed.message?.content?.some((c: any) => c.type === "tool_result"))
            ) {
              stepCount++;
              onStepUpdate?.(stepCount);
            }

            // Look for the final result message
            if (parsed.type === "result") {
              console.log("\n🏆 CLAUDE FINAL RESULT:");
              console.log("-".repeat(80));
              console.log(parsed.result || "No result content");
              console.log("-".repeat(80));

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

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
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
        reject(new Error("No result message received from Claude CLI"));
      }
    });

    child.on("error", (error) => {
      if (isResolved) return;
      isResolved = true;
      clearTimeout(timeout);
      reject(new Error(`Failed to spawn Claude CLI: ${error.message}`));
    });

    // Close stdin to ensure Claude doesn't wait for input
    child.stdin.end();
  });
}
