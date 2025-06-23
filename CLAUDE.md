## TypeScript Best Practices

- Make sure type imports use the correct syntax. e.g. import { simpleGit, type SimpleGit } from 'simple-git'; or import type { SimpleGit } from 'simple-git';
- Using the IDE, check type errors after making changes to ensure type safety and catch potential issues early

## Testing
- When using Vitest with Bun, you need to use `bun run test` to run vitest. `bun test` runs Bun's built-in test runner, not Vitest.