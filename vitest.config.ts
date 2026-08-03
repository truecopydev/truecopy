import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['src/**/*.test.ts', 'example/*.test.ts', 'bin/*.test.ts'],
		environment: 'node',
		coverage: {
			provider: 'v8',
			reporter: ['text-summary'],
			include: ['src/**/*.ts'],
			exclude: ['**/*.test.ts', 'src/index.ts'],
			// A ratchet: these only ever go up. A kit that measures others measures
			// itself first.
			thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 }
		}
	}
});
