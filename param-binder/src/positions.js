// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

/**
 * @typedef {Object} SourcePos
 * @property {number} offset - Zero-based character offset inside the source text.
 * @property {number} line   - One-based line number.
 * @property {number} column - One-based column number.
 * @property {string} [file] - Optional file name handed in with the signature model.
 */

/**
 * Convert a zero-based character offset into a 1-based line/column pair.
 * Pure string indexing only: no TypeScript parser or checker is involved.
 *
 * @param {string} text
 * @param {number} offset
 * @param {string} [file]
 * @returns {SourcePos}
 */
function toPos(text, offset, file) {
  if (!Number.isInteger(offset) || offset < 0 || offset > text.length) {
    throw new RangeError(`toPos(): offset ${offset} is outside of the source text`);
  }
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < offset; i++) {
    if (text.charCodeAt(i) === 10 /* \n */) {
      line++;
      lineStart = i + 1;
    }
  }
  return { offset, line, column: offset - lineStart + 1, ...(file ? { file } : {}) };
}

/**
 * Find `needle` inside `text`, optionally starting at `fromOffset`.
 *
 * @param {string} text
 * @param {string} needle
 * @param {number} [fromOffset]
 * @returns {number} Offset of the match, or -1 when it is absent.
 */
function indexOfPos(text, needle, fromOffset) {
  return text.indexOf(needle, fromOffset ?? 0);
}

/**
 * Locate an identifier/expression inside the source text of a signature model.
 * Returns a position pointing at the first match; throws if the token cannot be
 * found, which means the supplied model and its source mapping disagree.
 *
 * @param {string} source
 * @param {string} token
 * @param {string} [file]
 * @param {number} [fromOffset]
 * @returns {SourcePos}
 */
function locateToken(source, token, file, fromOffset) {
  if (typeof source !== 'string' || source.length === 0) {
    throw new Error('locateToken(): a non-empty signature source string is required');
  }
  const offset = indexOfPos(source, token, fromOffset);
  if (offset < 0) {
    throw new Error(`locateToken(): token ${JSON.stringify(token)} was not found in the signature source`);
  }
  return toPos(source, offset, file);
}

/**
 * @param {SourcePos} pos
 * @returns {string}
 */
function formatPos(pos) {
  const where = pos.file ? `${pos.file}:` : '';
  return `${where}${pos.line}:${pos.column}`;
}

module.exports = { toPos, indexOfPos, locateToken, formatPos };
