/**
 * A `process` global for the web test bundle.
 *
 * Only the test bundle needs this. The extension itself touches nothing from
 * Node, and test/bundle.test.mjs fails the build if it starts to. What needs
 * it is what the tests drag in: mocha's browser entry assigns to
 * process.stdout on its first line, and the assert shim reads process.env.
 *
 * esbuild does not polyfill Node globals. Naming this file in `inject`
 * rewrites every free `process` in the bundle to the export below, which is
 * the same trick webpack's ProvidePlugin does in the official web extension
 * sample.
 */

import process from 'process';

export { process };
