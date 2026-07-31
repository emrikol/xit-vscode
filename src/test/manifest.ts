/**
 * The parts of package.json that the integration tests need, as literals.
 *
 * The tests used to read the manifest with `require('../../package.json')`.
 * That works in the Electron host, which is Node with a file system, and it
 * cannot work in the web host, which is a web worker with neither. Literals
 * run in both.
 *
 * The price of a literal is drift. `test/manifest.test.mjs` reads this file
 * and package.json and fails if the two disagree, so the drift is caught by
 * the pre-commit suite rather than by a test that quietly checks nothing.
 */

export const PUBLISHER = 'emrikol';
export const NAME = 'xit';

/**
 * publisher + name is the extension's global identity, and the id that
 * `vscode.extensions.getExtension` takes.
 */
export const EXTENSION_ID = `${PUBLISHER}.${NAME}`;

/** Every id in contributes.commands, in manifest order. */
export const COMMANDS = ['xit.suggest', 'xit.toggle', 'xit.shuffle', 'xit.refreshItems', 'xit.toggleDoneItems', 'xit.migrate'];
