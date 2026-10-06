'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { bindParams } = require('../src/binder');

const examples = path.join(__dirname, '..', 'examples');
const load = (name) => require(path.join(examples, name));

test('param a and options.x bind separately to their own model nodes', () => {
  const report = bindParams(load('signature1.json'), load('doc1.json'));
  assert.equal(report.ok, true);
  assert.deepEqual(report.issues, []);
  const paths = report.bindings.map((b) => b.path);
  assert.deepEqual(paths, ['a', 'options.x', 'options.y']);
  const a = report.bindings.find((b) => b.path === 'a');
  const ox = report.bindings.find((b) => b.path === 'options.x');
  // Each binding preserves its own source path mapping (doc loc + param loc).
  assert.deepEqual(a.param.loc, { file: 'src/render.ts', line: 10, column: 17 });
  assert.deepEqual(ox.param.loc, { file: 'src/render.ts', line: 10, column: 25 });
  assert.equal(ox.doc.loc.line, 7);
});

test('documenting options.y when the model only provides options.x is reported as extra', () => {
  const model = {
    functionName: 'f',
    params: [
      { name: 'a', loc: { line: 1, column: 10 } },
      {
        name: 'options',
        destructured: true,
        loc: { line: 1, column: 13 },
        children: [{ name: 'x', loc: { line: 1, column: 15 } }]
      }
    ]
  };
  const doc = {
    params: [
      { path: 'a', text: 'a', loc: { line: 3, column: 5 } },
      { path: 'options.x', text: 'x', loc: { line: 4, column: 5 } },
      { path: 'options.y', text: 'not in model', loc: { line: 5, column: 5 } }
    ]
  };
  const report = bindParams(model, doc);
  assert.equal(report.ok, false);
  const extra = report.issues.filter((i) => i.kind === 'extra');
  assert.equal(extra.length, 1);
  assert.equal(extra[0].path, 'options.y');
  assert.deepEqual(extra[0].locs, [{ line: 5, column: 5 }]);
});

test('duplicate path a is reported once with both source positions', () => {
  const report = bindParams(load('signature2.json'), load('doc2.json'));
  const duplicates = report.issues.filter((i) => i.kind === 'duplicate');
  assert.equal(duplicates.length, 1);
  assert.equal(duplicates[0].path, 'a');
  assert.equal(duplicates[0].locs.length, 2);
  assert.deepEqual(duplicates[0].locs[0], { file: 'src/configure.ts', line: 14, column: 5 });
  assert.deepEqual(duplicates[0].locs[1], { file: 'src/configure.ts', line: 15, column: 5 });
});

test('destructured parameter without a provided child model marks child docs unknown', () => {
  const report = bindParams(load('signature2.json'), load('doc2.json'));
  const unknown = report.issues.filter((i) => i.kind === 'unknown');
  assert.equal(unknown.length, 1);
  assert.equal(unknown[0].path, 'flags.verbose');
  // unknown is a warning, not a hard error kind
  assert.ok(unknown[0].message.includes('flags'));
});

test('optional parameters are NOT exempt from documentation', () => {
  const report = bindParams(load('signature2.json'), load('doc2.json'));
  const missing = report.issues.filter((i) => i.kind === 'missing').map((i) => i.path);
  // "level" is optional with a default, yet undocumented -> missing
  assert.ok(missing.includes('level'));
});

test('missing documentation is reported for undocumented model params', () => {
  const model = { params: [{ name: 'a', loc: { line: 2, column: 5 } }] };
  const report = bindParams(model, { params: [] });
  assert.equal(report.ok, false);
  assert.deepEqual(
    report.issues.map((i) => [i.kind, i.path]),
    [['missing', 'a']]
  );
  assert.deepEqual(report.issues[0].locs, [{ line: 2, column: 5 }]);
});

test('default expressions are displayed as raw text and never evaluated', () => {
  const model = {
    params: [{ name: 'level', optional: true, default: '1 + 1', loc: { line: 1, column: 1 } }]
  };
  const doc = { params: [{ path: 'level', text: 'Level.', loc: { line: 1, column: 1 } }] };
  const report = bindParams(model, doc);
  assert.equal(report.ok, true);
  assert.equal(report.bindings[0].param.default, '1 + 1'); // NOT 2
});

test('binder never executes documented functions or reads outside the models', () => {
  // A hostile default expression must remain inert text.
  const model = {
    params: [{ name: 'x', default: 'process.exit(1)', loc: { line: 1, column: 1 } }]
  };
  const doc = { params: [{ path: 'x', text: 'x', loc: { line: 1, column: 1 } }] };
  const report = bindParams(model, doc);
  assert.equal(report.bindings[0].param.default, 'process.exit(1)');
});

test('example 2 produces the expected issue mix', () => {
  const report = bindParams(load('signature2.json'), load('doc2.json'));
  assert.equal(report.ok, false);
  const byKind = {};
  for (const issue of report.issues) {
    byKind[issue.kind] = (byKind[issue.kind] || 0) + 1;
  }
  assert.deepEqual(byKind, { duplicate: 1, extra: 1, unknown: 1, missing: 2 });
});
