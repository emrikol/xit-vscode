/**
 * Selection helpers, kept free of the `vscode` module so they can be unit
 * tested. Only the shape actually used is required, not the full API type.
 */

export interface LineRange {
	readonly start: { readonly line: number };
	readonly end: { readonly line: number };
}

/**
 * Every line number touched by `selections`, without duplicates, in ascending
 * order.
 *
 * Overlapping or multi-cursor selections regularly cover the same line twice,
 * so the de-duplication is load bearing.
 */
export function selectedLines(selections: readonly LineRange[]): number[] {
	const lines = new Set<number>();

	for (const selection of selections) {
		for (let line = selection.start.line; line <= selection.end.line; line++) {
			lines.add(line);
		}
	}

	return [...lines].sort((a, b) => a - b);
}
