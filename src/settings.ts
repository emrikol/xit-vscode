/**
 * Reading the configuration, in one place.
 *
 * This imports `vscode`, so it is not unit tested. It exists anyway, because
 * what it removes is worth more than what a test of it would prove: the same
 * three settings were read inline in six places across three modules, each
 * repeating the default value beside the key.
 *
 * That is the shape of a bug this repo has already had twice. A default
 * written six times is six chances to change five of them, and the failure is
 * silent - the sidebar, the editor decorations and Sort Group would simply
 * disagree about which items are late, which is precisely the disagreement
 * `test/surfaces.test.mjs` was written to catch after it happened.
 */

import * as vscode from 'vscode';

import type { Thresholds } from './collect';
import { todayFrom } from './dueDate';
import { isTagName } from './stamp';

const SECTION = 'xit';

/**
 * A configured tag name, or the default where the setting is not one.
 *
 * A hand-edited setting should not be able to make the extension write a tag
 * the format cannot parse.
 */
function tagName(key: string, fallback: string): string {
	const found = vscode.workspace.getConfiguration(SECTION).get<string>(key, fallback);
	return isTagName(found) ? found : fallback;
}

/**
 * When an item counts as due soon, overdue, and critically overdue.
 *
 * `today` is read here rather than passed in, so nothing downstream needs a
 * clock, and every surface asking this question gets the same answer within a
 * single run.
 */
export function thresholds(): Thresholds {
	const configuration = vscode.workspace.getConfiguration(SECTION);

	return {
		today: todayFrom(new Date()),
		criticalAfterDays: configuration.get<number>('criticallyOverdueAfterDays', 14),
		soonWithinDays: configuration.get<number>('dueSoonWithinDays', 7),
	};
}

/** The tag carrying a time estimate. */
export function estimateTag(): string {
	return tagName('estimateTag', 'est');
}

/** The tags recording when an item was created and finished. */
export function dateTags(): { creation: string; completion: string } {
	return { creation: tagName('creationDateTag', 'created'), completion: tagName('completionDateTag', 'done') };
}
