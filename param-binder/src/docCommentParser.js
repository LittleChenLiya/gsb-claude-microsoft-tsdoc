// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

const { toPos } = require('./positions');

/**
 * @typedef {Object} ParamBlock
 * @property {string} path        - Dotted path written after `@param`, e.g. "options.x".
 * @property {string[]} segments  - Explicit destructuring path segments.
 * @property {string} description - Trimmed description text (may be empty).
 * @property {SourcePos} namePos  - Position of the path token in the comment source.
 * @property {{start: SourcePos, end: SourcePos}} range - Whole `@param` block range.
 *
 * @typedef {Object} ParseResult
 * @property {ParamBlock[]} params
 * @property {{message: string, pos: SourcePos}[]} malformed
 */

const PARAM_HEADER_RE = /^[ \t]*(?:\/)?\*+?[ \t]*@param\b(?<rest>.*)$/;
const TAG_LINE_RE = /^[ \t]*(?:\/)?\*+?[ \t]*@\w/;
const IDENT_SEGMENT_RE = /^[A-Za-z_$][\w$]*$/;

/**
 * Extract every `@param` block from a raw doc comment (or a source snippet that
 * contains one). Deliberately small and explicit: block tags are detected by
 * name and the *written* path is kept verbatim. Nothing about the surrounding
 * function signature is guessed here; model binding happens in binder.js.
 *
 * Supported header spellings:
 *   `@param a - description`
 *   `@param {string} a description`     (JSDoc type annotation)
 *   `@param [options.x] - description`  (JSDoc optional brackets)
 *
 * @param {string} source - Raw `/** ... *\/` comment text.
 * @returns {ParseResult}
 */
function parseDocComment(source) {
  if (typeof source !== 'string') {
    throw new TypeError('parseDocComment(): source must be a string');
  }

  /** @type {ParamBlock[]} */
  const params = [];
  /** @type {{message: string, pos: SourcePos}[]} */
  const malformed = [];

  const lines = source.split('\n');
  /** @type {number[]} */
  const lineStarts = [0];
  for (const line of lines.slice(0, -1)) {
    lineStarts.push(lineStarts[lineStarts.length - 1] + line.length + 1);
  }

  /**
   * @param {number} lineIndex
   * @param {number} column
   */
  function posAt(lineIndex, column) {
    return toPos(source, lineStarts[lineIndex] + column);
  }

  let i = 0;
  while (i < lines.length) {
    const rawLine = lines[i];
    const match = PARAM_HEADER_RE.exec(rawLine);
    if (!match) {
      i++;
      continue;
    }

    const tagColumn = rawLine.indexOf('@param');

    // Work on the header suffix while remembering where in the raw line the
    // path token search must start (past a JSDoc `{type}` annotation).
    /** @type {string} */
    let suffix = match.groups.rest;
    let searchFrom = tagColumn + '@param'.length;

    const typeMatch = /^\s*\{[^}]*\}/.exec(suffix);
    if (typeMatch) {
      suffix = suffix.slice(typeMatch[0].length);
      searchFrom += typeMatch[0].length;
    }
    suffix = suffix.trimStart();
    searchFrom = rawLine.indexOf(suffix, searchFrom);
    if (searchFrom < 0) {
      searchFrom = tagColumn + '@param'.length;
    }

    // Accept (but do not interpret) JSDoc optional brackets: `[name]` /
    // `[name=default]`. The token itself is located via rawLine.indexOf, so
    // brackets never distort the reported column.
    if (suffix.trimStart().startsWith('[')) {
      const close = suffix.indexOf(']');
      if (close < 0) {
        malformed.push({
          message: '@param optional bracket "[...]" is not closed',
          pos: posAt(i, tagColumn)
        });
        i++;
        continue;
      }
      suffix = suffix.slice(1, close) + suffix.slice(close + 1);
    }

    const tokenMatch = /^(\S+)[ \t]*(.*)$/.exec(suffix.trim());
    if (!tokenMatch) {
      malformed.push({
        message: '@param tag is missing a parameter path',
        pos: posAt(i, tagColumn)
      });
      i++;
      continue;
    }
    const pathToken = tokenMatch[1];
    const inlineDesc = tokenMatch[2]
      .replace(/\*\/[ \t]*$/, '')
      .replace(/^-\s?/, '')
      .trim();

    const nameColumn = rawLine.indexOf(pathToken, searchFrom);

    // Continuation lines up to the next block tag belong to this description.
    /** @type {string[]} */
    const descLines = inlineDesc ? [inlineDesc] : [];
    let endLineInclusive = i;
    let j = i + 1;
    while (j < lines.length && !TAG_LINE_RE.test(lines[j])) {
      let body = lines[j].replace(/^[ \t]*\*?[ \t]?/, '');
      // A line consisting only of the block-comment terminator ends the block;
      // it is not part of the description.
      if (/^\s*\*\/[ \t]*$/.test(lines[j])) {
        break;
      }
      // Drop an inline terminator if the comment closes on a description line.
      body = body.replace(/\*\/[ \t]*$/, '');
      body = body.trim();
      if (body.length > 0) {
        descLines.push(body);
      }
      endLineInclusive = j;
      j++;
    }

    const segments = pathToken.split('.').map((s) => s.trim()).filter((s) => s.length > 0);
    if (segments.length === 0 || segments.some((s) => !IDENT_SEGMENT_RE.test(s))) {
      malformed.push({
        message: `@param path ${JSON.stringify(pathToken)} is not a dotted identifier path`,
        pos: nameColumn >= 0 ? posAt(i, nameColumn) : posAt(i, tagColumn)
      });
      i = j;
      continue;
    }

    params.push({
      path: segments.join('.'),
      segments,
      description: descLines.join(' ').trim(),
      namePos: nameColumn >= 0 ? posAt(i, nameColumn) : posAt(i, tagColumn),
      range: {
        start: posAt(i, tagColumn),
        end: toPos(source, lineStarts[endLineInclusive] + lines[endLineInclusive].length)
      }
    });
    i = j;
  }

  return { params, malformed };
}

module.exports = { parseDocComment };
