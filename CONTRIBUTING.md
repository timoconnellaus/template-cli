# Contributing to Template CLI

Thank you for your interest in contributing to Template CLI! This document provides guidelines for development, testing, and releasing.

## Development Setup

### Prerequisites
- [Bun](https://bun.sh) (latest version)
- Git
- Node.js 18+ (for npm publishing)

### Local Development

```bash
# Clone the repository
git clone https://github.com/timoaus/template-update-cli.git
cd template-update-cli

# Install dependencies
bun install

# Run tests
bun run test

# Run tests in watch mode
bun run test:watch

# Build the CLI
bun run build

# Test the built CLI
./dist/index.js --help

# Run CLI in development mode
bun run dev --help
```

## Project Structure

```
├── src/
│   ├── commands/          # CLI command implementations
│   │   ├── init.ts       # Project initialization
│   │   ├── check.ts      # Check pending migrations
│   │   ├── update.ts     # Apply migrations
│   │   ├── sync.ts       # Historical synchronization
│   │   └── generate.ts   # Generate migrations
│   ├── utils/            # Shared utilities
│   │   ├── similarity-utils.ts   # Similarity scoring
│   │   ├── state-utils.ts        # State reconstruction
│   │   ├── diff-utils.ts         # Diff operations
│   │   ├── file-utils.ts         # File operations
│   │   └── ...
│   └── __tests__/        # Test files
├── index.ts              # CLI entry point
├── dist/                 # Built output
└── docs/                 # Documentation
```

## Testing

### Running Tests

```bash
# Run all tests
bun run test

# Run tests in watch mode
bun run test:watch

# Run specific test file
bun run test src/__tests__/commands/sync.test.ts

# Run tests with specific pattern
bun run test -t "sync command"
```

### Test Structure

- **Unit Tests**: `src/__tests__/utils/` - Test individual utilities
- **Command Tests**: `src/__tests__/commands/` - Test CLI commands
- **Integration Tests**: `src/__tests__/integration/` - Test end-to-end workflows

### Writing Tests

When adding new features:

1. **Write unit tests** for new utilities
2. **Write command tests** for CLI functionality
3. **Add integration tests** for complex workflows
4. **Ensure 100% test coverage** for critical paths

Example test structure:
```typescript
import { describe, it, expect } from 'vitest';
import { myFunction } from '../utils/my-utils.js';

describe('myFunction', () => {
  it('should handle basic case', () => {
    const result = myFunction('input');
    expect(result).toBe('expected');
  });

  it('should handle edge case', () => {
    const result = myFunction('');
    expect(result).toBe('');
  });
});
```

## Commit Conventions

We use [Conventional Commits](https://www.conventionalcommits.org/) for automatic version bumping:

### Commit Types

- **`feat:`** - New features (triggers minor version bump)
- **`fix:`** - Bug fixes (triggers patch version bump)
- **`docs:`** - Documentation changes (triggers patch version bump)
- **`style:`** - Code style changes (triggers patch version bump)
- **`refactor:`** - Code refactoring (triggers patch version bump)
- **`test:`** - Test additions/changes (triggers patch version bump)
- **`chore:`** - Build/tooling changes (triggers patch version bump)
- **`BREAKING CHANGE:`** or **`feat!:`** - Breaking changes (triggers major version bump)

### Examples

```bash
git commit -m "feat: add historical state reconstruction to sync command"
git commit -m "fix: resolve conflict when diff context doesn't match"
git commit -m "docs: update README with sync workflow examples"
git commit -m "feat!: change CLI interface for better usability"
```

## Release Process

### Automated Releases (Recommended)

Releases are automatically handled by GitHub Actions when you push to the `master` branch:

1. **Make your changes** and commit using conventional commit format
2. **Push to master**: `git push origin master`
3. **GitHub Action automatically**:
   - Runs all tests
   - Determines version bump based on commit messages
   - Updates package.json version
   - Creates git tag
   - Creates GitHub release
   - Publishes to npm

### Manual Version Bumping

For manual control over versioning:

```bash
# Patch version (1.0.0 → 1.0.1)
npm run release:patch

# Minor version (1.0.0 → 1.1.0)
npm run release:minor

# Major version (1.0.0 → 2.0.0)
npm run release:major
```

These commands will:
- Update package.json version
- Create git tag
- Push to repository (triggering automatic npm publish)

### Version Bump Guidelines

- **Patch** (1.0.x): Bug fixes, documentation, small improvements
- **Minor** (1.x.0): New features, significant improvements that are backward compatible
- **Major** (x.0.0): Breaking changes that require user action

## GitHub Actions Setup

### Required Secrets

The repository needs these secrets configured in GitHub:

1. **`NPM_TOKEN`**: Your npm authentication token
   ```bash
   # Generate token at https://www.npmjs.com/settings/tokens
   # Use "Automation" token type for CI/CD
   ```

2. **`GITHUB_TOKEN`**: Automatically provided by GitHub Actions

### Workflow Files

- **`.github/workflows/test.yml`**: Runs tests on PRs
- **`.github/workflows/release.yml`**: Handles releases on master push

## npm Publishing

### Setup npm Authentication

```bash
# Login to npm (one-time setup)
npm login

# Verify you're logged in as the correct user
npm whoami
# Should output: timoaus
```

### Publishing Process

Publishing is handled automatically by GitHub Actions, but for manual publishing:

```bash
# Build and run tests
npm run prepublishOnly

# Publish to npm (requires npm login)
npm publish --access public

# Verify publication
npm info @timoaus/template-cli
```

### Package Configuration

Key npm configuration in `package.json`:
- **`name`**: `@timoaus/template-cli`
- **`bin`**: Points to `./dist/index.js`
- **`files`**: Controls what gets published
- **`access`**: Public (for scoped packages)

## Code Quality

### TypeScript

- Use strict TypeScript configuration
- Add type annotations for public APIs
- Avoid `any` types where possible

### Code Style

- Use consistent formatting (handled by editor)
- Follow existing code patterns
- Add JSDoc comments for complex functions

### Error Handling

- Provide clear error messages
- Handle edge cases gracefully
- Use proper exit codes for CLI commands

## Documentation

### When to Update Documentation

- **README.md**: When adding new features or changing CLI interface
- **SPEC.md**: When changing core architecture or adding new concepts
- **SYNC.md**: When modifying sync algorithm or behavior
- **CHANGELOG.md**: Automatically updated by release process

### Documentation Standards

- Use clear, concise language
- Include practical examples
- Keep documentation up-to-date with code changes
- Test all code examples

## Getting Help

- **Issues**: Open GitHub issues for bugs or feature requests
- **Discussions**: Use GitHub Discussions for questions
- **Email**: Contact maintainers for security issues

## License

By contributing to Template CLI, you agree that your contributions will be licensed under the MIT License.