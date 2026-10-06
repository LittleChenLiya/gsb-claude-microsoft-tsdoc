// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

/* eslint-disable no-console */

const { bindParamDocs, renderSignature, formatReport } = require('./binder');
const { locateToken } = require('./positions');

/**
 * Example 1: destructured options with an EXPLICIT children model.
 *  - `a` and `options.x` are bound separately.
 *  - The comment writes `options.y`, which is not in the model: "extra".
 *  - `a` is documented twice; BOTH written @param positions are reported.
 */
const SOURCE_1 = [
  '// sample file: drawChart.ts',
  'export function drawChart(',
  '  a: number,',
  '  options: { x: number }',
  '): void {',
  '  // The binder never executes this function.',
  '}'
].join('\n');

const SIGNATURE_1 = {
  name: 'drawChart',
  params: [
    {
      name: 'a',
      pos: locateToken(SOURCE_1, 'a: number', 'drawChart.ts')
    },
    {
      name: 'options',
      pos: locateToken(SOURCE_1, 'options: {', 'drawChart.ts'),
      // Explicit destructuring model: the binder walks THIS list only.
      children: [
        {
          name: 'x',
          pos: locateToken(SOURCE_1, 'x: number', 'drawChart.ts')
        }
      ]
    }
  ]
};

const DOC_1 = [
  '/**',
  ' * Draws a chart.',
  ' *',
  ' * @param a - the first parameter (bound to parameter "a")',
  ' * @param options.x - horizontal coordinate (bound to destructured x)',
  ' * @param options.y - not part of the modeled signature (extra)',
  ' * @param a - duplicated on purpose; both spots are reported',
  ' */'
].join('\n');

/**
 * Example 2: an OPTIONAL parameter with a default expression, plus a parameter
 * whose destructuring model is intentionally NOT supplied.
 *  - `timeout` is optional and has a default; defaults are DISPLAYED ONLY and
 *    never evaluated (the sentinel below would throw if it ran).
 *  - `settings` has no `children`, so `settings.mode` is "unknown" rather than
 *    guessed.
 *  - `retry` is optional and documented. `timeout` is NOT documented: even
 *    optional parameters must have a @param description.
 */
let defaultEvaluated = false;
function sentinelDefault() {
  defaultEvaluated = true;
  throw new Error('default expression must never be evaluated by the binder');
}

const SOURCE_2 = [
  '// sample file: configure.ts',
  'function configure(',
  '  name: string,',
  '  timeout: number = sentinelDefault(),',
  "  settings: { mode: 'auto' },",
  '  retry?: number = 3',
  ') {}'
].join('\n');

const SIGNATURE_2 = {
  name: 'configure',
  params: [
    {
      name: 'name',
      pos: locateToken(SOURCE_2, 'name: string', 'configure.ts')
    },
    {
      name: 'timeout',
      optional: true,
      // Verbatim expression: the binder only renders this string.
      defaultExpression: 'sentinelDefault()',
      pos: locateToken(SOURCE_2, 'timeout: number', 'configure.ts')
    },
    {
      name: 'settings',
      pos: locateToken(SOURCE_2, 'settings:', 'configure.ts')
      // NOTE: no "children" model is provided for this destructured parameter.
    },
    {
      name: 'retry',
      optional: true,
      defaultExpression: '3',
      pos: locateToken(SOURCE_2, 'retry?', 'configure.ts')
    }
  ]
};

const DOC_2 = [
  '/**',
  ' * Configures a session.',
  ' *',
  ' * @param name - session name',
  ' * @param settings - session settings (its destructuring model is not supplied)',
  ' * @param settings.mode - model for "settings" was not supplied (unknown)',
  ' * @param retry - optional retry count',
  ' */'
].join('\n');

/**
 * Run one example and print its signature, binding report and default safety.
 *
 * @param {string} title
 * @param {SignatureModel} signature
 * @param {string} doc
 * @param {{defaultEvaluated?: boolean}} [sentinel]
 */
function runExample(title, signature, doc, sentinel) {
  console.log('============================================================');
  console.log(title);
  console.log('------------------------------------------------------------');
  console.log('Signature model (default expressions rendered verbatim):');
  console.log(renderSignature(signature));
  console.log('');
  const result = bindParamDocs(signature, doc);
  console.log(formatReport(result));
  console.log('');
  console.log('ok = ' + result.ok);
  if (sentinel) {
    console.log(
      'default expression evaluated by binder? ' +
      (sentinel.defaultEvaluated ? 'YES (BUG!)' : 'no (display only)')
    );
  }
  console.log('');
}

function main() {
  runExample('Example 1: drawChart(a, options: { x })', SIGNATURE_1, DOC_1);
  runExample('Example 2: configure(name, timeout?, settings, retry?)', SIGNATURE_2, DOC_2, {
    get defaultEvaluated() {
      return defaultEvaluated;
    }
  });
}

main();
