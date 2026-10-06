// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

// Deterministic, dependency-free acceptance tests.
// Run with:  node test/binder.test.js

const assert = require('assert');
const {
  bindParamDocs,
  flattenParameters,
  renderSignature
} = require('../src/binder');
const { parseDocComment } = require('../src/docCommentParser');

/** @type {{name: string, fn: () => void}[]} */
const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

function codes(result, code) {
  return result.diagnostics.filter((d) => d.code === code);
}

test('flatten: top-level and explicit destructured paths are listed without guessing', () => {
  const flat = flattenParameters([
    { name: 'a' },
    { name: 'options', children: [{ name: 'x' }, { name: 'y' }] }
  ]);
  assert.deepStrictEqual(
    flat.map((f) => f.path),
    ['a', 'options.x', 'options.y', 'options']
  );
  assert.strictEqual(flat.find((f) => f.path === 'options').isLeaf, false);
  assert.strictEqual(flat.find((f) => f.path === 'options.x').isLeaf, true);
});

test('bind: "a" and "options.x" bind separately and keep source positions', () => {
  const doc = [
    '/**',
    ' * @param a - first',
    ' * @param options.x - x value',
    ' */'
  ].join('\n');
  const result = bindParamDocs(
    {
      name: 'f',
      params: [
        { name: 'a', pos: { offset: 100, line: 10, column: 3 } },
        {
          name: 'options',
          pos: { offset: 120, line: 11, column: 3 },
          children: [{ name: 'x', pos: { offset: 130, line: 11, column: 15 } }]
        }
      ]
    },
    doc
  );
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.bindings.map((b) => b.path), ['a', 'options.x']);
  // Doc comment source positions preserved (file-less).
  assert.strictEqual(result.bindings[0].doc.namePos.line, 2);
  assert.strictEqual(result.bindings[0].doc.namePos.column, 11);
  // Model source positions preserved.
  assert.strictEqual(result.bindings[0].model.pos.line, 10);
  assert.strictEqual(result.bindings[1].model.pos.line, 11);
  assert.strictEqual(result.bindings[1].model.pos.column, 15);
});

test('extra: a documented sub-path absent from the model is "extra"', () => {
  const doc = [
    '/**',
    ' * @param a - first',
    ' * @param options.x - x value',
    ' * @param options.y - not modeled',
    ' */'
  ].join('\n');
  const result = bindParamDocs(
    {
      params: [
        { name: 'a' },
        { name: 'options', children: [{ name: 'x' }] }
      ]
    },
    doc
  );
  const extra = codes(result, 'extra');
  assert.strictEqual(extra.length, 1);
  assert.ok(extra[0].message.includes('options.y'));
  assert.strictEqual(extra[0].positions[0].line, 4);
});

test('duplicate: repeated @param reports BOTH written positions plus model pos', () => {
  const doc = [
    '/**',
    ' * @param a - first write',
    ' * @param b - second param',
    ' * @param a - second write',
    ' */'
  ].join('\n');
  const modelPos = { offset: 5, line: 20, column: 3, file: 'f.ts' };
  const result = bindParamDocs(
    { params: [{ name: 'a', pos: modelPos }, { name: 'b' }] },
    doc
  );
  const dup = codes(result, 'duplicate');
  assert.strictEqual(dup.length, 1);
  assert.ok(dup[0].message.includes('"a"'));
  assert.deepStrictEqual(
    dup[0].positions.map((p) => p.line),
    [2, 4, 20] // first write, second write, model declaration
  );
});

test('unknown: sub-path under a parameter without a children model is "unknown"', () => {
  const doc = [
    '/**',
    ' * @param settings - settings object',
    ' * @param settings.mode - cannot be bound',
    ' */'
  ].join('\n');
  const settingsPos = { offset: 9, line: 31, column: 3, file: 'f.ts' };
  const result = bindParamDocs(
    { params: [{ name: 'settings', pos: settingsPos }] }, // no "children"
    doc
  );
  const unknown = codes(result, 'unknown');
  assert.strictEqual(unknown.length, 1);
  assert.ok(unknown[0].message.includes('settings.mode'));
  assert.ok(unknown[0].message.includes('no destructuring model'));
  assert.deepStrictEqual(
    unknown[0].positions.map((p) => p.line),
    [3, 31] // doc position + model position
  );
  assert.strictEqual(codes(result, 'extra').length, 0);
});

test('missing: an OPTIONAL parameter without @param is still an error', () => {
  const doc = '/**\n * @param name - n\n */';
  const result = bindParamDocs(
    {
      params: [
        { name: 'name' },
        { name: 'timeout', optional: true, defaultExpression: '3000' }
      ]
    },
    doc
  );
  const missing = codes(result, 'missing');
  assert.strictEqual(missing.length, 1);
  assert.ok(missing[0].message.includes('timeout'));
  assert.ok(missing[0].message.includes('optional'));
});

test('missing: a parent with modeled children is documented through its leaves', () => {
  const doc = [
    '/**',
    ' * @param options - object itself',
    ' * @param options.x - x',
    ' */'
  ].join('\n');
  const result = bindParamDocs(
    { params: [{ name: 'options', children: [{ name: 'x' }, { name: 'y' }] }] },
    doc
  );
  // Documenting the parent is allowed; leaf "y" is still required.
  const missing = codes(result, 'missing');
  assert.deepStrictEqual(missing.map((m) => m.message), [
    'parameter "options.y" is missing a @param description'
  ]);
});

test('default expression: displayed verbatim and never evaluated', () => {
  let evaluated = false;
  const signature = {
    params: [
      {
        name: 'x',
        optional: true,
        defaultExpression: 'sideEffectDefault()'
      }
    ]
  };
  const rendered = renderSignature(signature);
  assert.ok(rendered.includes('= sideEffectDefault()'), rendered);
  assert.strictEqual(evaluated, false);
  // Binding itself must not touch the expression either.
  const result = bindParamDocs(signature, '/**\n * @param x - x\n */');
  assert.strictEqual(result.ok, true);
  assert.strictEqual(evaluated, false);
});

test('malformed: @param without a path and non-identifier paths are reported', () => {
  const doc = [
    '/**',
    ' * @param',
    ' * @param options.1bad - invalid segment',
    ' */'
  ].join('\n');
  const result = bindParamDocs({ params: [] }, doc);
  assert.ok(codes(result, 'malformed').length >= 2);
});

test('JSDoc spellings: {type} and [brackets] headers parse to clean paths', () => {
  const doc = [
    '/**',
    ' * @param {string} a - typed',
    ' * @param [options.x] - bracketed optional',
    ' */'
  ].join('\n');
  const parsed = parseDocComment(doc);
  assert.deepStrictEqual(parsed.params.map((p) => p.path), ['a', 'options.x']);
  assert.strictEqual(parsed.params[0].description, 'typed');
});

test('single-line comment: /** @param z - text */ parses with clean text', () => {
  const parsed = parseDocComment('/** @param z - one-liner */');
  assert.strictEqual(parsed.params.length, 1);
  assert.strictEqual(parsed.params[0].path, 'z');
  assert.strictEqual(parsed.params[0].description, 'one-liner');
  assert.strictEqual(parsed.params[0].namePos.column, 12);
});

let failures = 0;
for (const t of tests) {
  try {
    t.fn();
    console.log('PASS  ' + t.name);
  } catch (err) {
    failures++;
    console.log('FAIL  ' + t.name);
    console.log('      ' + (err && err.stack ? err.stack.split('\n').slice(0, 3).join('\n      ') : err));
  }
}
console.log('');
console.log(tests.length - failures + '/' + tests.length + ' tests passed');
if (failures > 0) {
  process.exitCode = 1;
}
