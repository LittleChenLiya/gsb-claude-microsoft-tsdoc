'use strict';

/**
 * CLI: bind a provided signature model against a provided DocComment model.
 *
 *   node param-binder/src/cli.js <signature-model.json> <doccomment.json>
 *
 * Prints a human-readable report plus the machine-readable JSON report.
 * Exit code 1 when any error-kind issue (missing / extra / duplicate)
 * is found; "unknown" issues are warnings and do not fail the run.
 */

const fs = require('fs');
const path = require('path');
const { bindParams } = require('./binder');

function formatLoc(loc) {
  if (!loc) {
    return '<no-loc>';
  }
  const file = loc.file ? `${loc.file}:` : '';
  return `${file}${loc.line != null ? loc.line : '?'}:${loc.column != null ? loc.column : '?'}`;
}

function main(argv) {
  const [modelPath, docPath] = argv;
  if (!modelPath || !docPath) {
    console.error('Usage: node param-binder/src/cli.js <signature-model.json> <doccomment.json>');
    return 2;
  }

  const model = JSON.parse(fs.readFileSync(path.resolve(modelPath), 'utf8'));
  const doc = JSON.parse(fs.readFileSync(path.resolve(docPath), 'utf8'));

  const report = bindParams(model, doc);

  console.log(`Function: ${report.functionName || '<unnamed>'}`);
  console.log('');
  console.log('Bindings:');
  for (const binding of report.bindings) {
    const def = binding.param.default !== null
      ? ` default=${JSON.stringify(binding.param.default)} (raw, not evaluated)`
      : '';
    const opt = binding.param.optional ? ' optional' : '';
    console.log(
      `  ${binding.path}  doc@${formatLoc(binding.doc.loc)} -> param@${formatLoc(binding.param.loc)}${opt}${def}`
    );
  }
  console.log('');
  console.log('Issues:');
  if (report.issues.length === 0) {
    console.log('  (none)');
  }
  for (const issue of report.issues) {
    const locs = (issue.locs || []).map(formatLoc).join(', ');
    console.log(`  [${issue.kind}] ${issue.path} @ ${locs}`);
    console.log(`      ${issue.message}`);
  }
  console.log('');
  console.log(JSON.stringify(report, null, 2));

  return report.ok ? 0 : 1;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = { main, formatLoc };
