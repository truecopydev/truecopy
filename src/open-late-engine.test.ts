import { describe, expect, it, vi } from 'vitest';

// The default engine is imported lazily: here it arrives after the deadline.
const engine = vi.hoisted(() => ({ created: 0 }));
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', async () => {
	await new Promise((resolve) => setTimeout(resolve, 40));
	return {
		GlobalWorkerOptions: {},
		getDocument: () => {
			engine.created += 1;
			return { promise: new Promise<never>(() => {}), destroy: async () => undefined };
		}
	};
});

const { openDocument } = await import('./open.js');
const { pdfWithText } = await import('./kit.js');

describe('an engine that loads after the deadline', () => {
	it('is never handed a document nobody would destroy', async () => {
		const file = new File([pdfWithText([{ word: 'a', x: 10, y: 700 }])], 'late.pdf', {
			type: 'application/pdf'
		});
		await expect(openDocument(file, { deadlineMilliseconds: 5 })).rejects.toMatchObject({
			reason: 'too-slow'
		});
		await new Promise((resolve) => setTimeout(resolve, 80));
		expect(engine.created).toBe(0);
	});
});
