# GitHub Issue Creation Prompt

You are creating a GitHub issue for the Template Update CLI project.

## First Steps

1. **Read the project documentation**: Start by reading `SYNC.md` file to understand the project architecture, commands, and current functionality.

2. **Understand the user's request**: The user's request is:
   <users-request>
   $ARGUMENTS
   </users-request>

## Issue Structure

Based on the user's input and your understanding of the project, create a well-structured GitHub issue with the following sections:

### Title

- Clear, concise description of the bug/feature
- Use prefixes: `[BUG]`, `[FEATURE]`, `[ENHANCEMENT]`, `[DOCS]` as appropriate

### Description

Provide a comprehensive description that includes:

**For Bugs:**

- Current behavior vs expected behavior
- Steps to reproduce
- Environment details (if relevant)
- Error messages or logs
- Impact on users/workflows

**For Features:**

- Problem statement (why is this needed?)
- Proposed solution or approach
- Use cases and examples
- Any alternatives considered

**For Enhancements:**

- Current functionality that needs improvement
- Specific improvements proposed
- Benefits to users

### Implementation Notes

- Reference relevant files in the codebase
- Mention specific commands/functions that may need changes
- Note any architectural considerations
- Identify potential breaking changes

### Acceptance Criteria

All issues must meet these criteria for completion:

- [ ] All existing tests continue to pass (`bun run test`)
- [ ] New functionality includes appropriate unit tests
- [ ] Integration tests added / modified where appropriate if the change affects command workflows
- [ ] The `SYNC.md` file is updated to reflect any changes to:
  - Command behavior or options
  - Architecture changes
  - New workflows or processes
  - API changes
- [ ] Code follows existing patterns and conventions
- [ ] No breaking changes without explicit discussion and approval

### Additional Context

- Link to related issues or discussions
- Screenshots or examples (if applicable)
- Migration considerations for existing users

## Quality Guidelines

- Be specific and actionable
- Provide enough context for developers unfamiliar with the request
- Consider both template users and template developers as audiences
- Think about edge cases and error scenarios
- Consider the impact on the migration generation and application workflows
