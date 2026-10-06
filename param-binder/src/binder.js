// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

const { parseDocComment } = require('./docCommentParser');
const { formatPos } = require('./positions');

/**
 * Signature model (supplied by the caller; this module never builds one itself):
 *
 * @typedef {Object} ParamModel
 * @property {string} name                 - Binding name at this level.
 * @property {boolean} [optional]          - Optional flag. OPTIONAL PARAMETERS
 *                                           ARE NOT automatically allowed to
 *                                           lack documentation.
 * @property {string} [defaultExpression]  - Verbatim default expression. It is
 *                                           displayed only and NEVER evaluated.
 * @property {SourcePos} [pos]             - Source position of the name.
 * @property {ParamModel[]} [children]     - Explicit destructuring model. When
 *                                           this property is present (even an
 *                                           empty array), the binder walks it
 *                                           instead of guessing names. When it
 *                                           is absent, documented sub-paths are
 *                                           reported as "unknown".
 *
 * @typedef {Object} SignatureModel
 * @property {string} [name]        - Function name, for display only.
 * @property {ParamModel[]} params  - Actual parameter list to bind against.
 *
 * @typedef {Object} ParamBinding
 * @property {string} path
 * @property {ParamBlock} doc
 * @property {FlatParam} model
 *
 * @typedef {Object} Diagnostic
 * @property {"missing"|"extra"|"unknown"|"duplicate"|"malformed"} code
 * @property {string} message
 * @property {SourcePos[]} positions
 *
 * @typedef {Object} BindResult
 * @property {ParamBinding[]} bindings
 * @property {Diagnostic[]} diagnostics
 * @property {boolean} ok
 *
 * @typedef {import('./docCommentParser').ParamBlock} ParamBlock
 *
 * @typedef {Object} FlatParam
 * @property {string} path
 * @property {string} name
 * @property {ParamModel} raw
 * @property {boolean} isLeaf
 * @property {SourcePos=} pos
 */

/**
 * Flatten the signature tree into dotted paths. Destructuring is represented
 * EXPLICITLY via `children`: no names are inferred from source text or types.
 *
 * @param {ParamModel[]} models
 * @returns {FlatParam[]}
 */
function flattenParameters(models) {
  /** @type {FlatParam[]} */
  const out = [];
  /**
   * @param {ParamModel[]} list
   * @param {string} prefix
   */
  function walk(list, prefix) {
    if (!Array.isArray(list)) {
      throw new TypeError('flattenParameters(): signature model params must be an array');
    }
    for (const node of list) {
      if (!node || typeof node.name !== 'string' || node.name.length === 0) {
        throw new Error('flattenParameters(): every parameter model needs a non-empty "name"');
      }
      const path = prefix ? prefix + '.' + node.name : node.name;
      const hasChildren = Array.isArray(node.children);
      if (hasChildren && node.children.length > 0) {
        walk(node.children, path);
      }
      out.push({
        path,
        name: node.name,
        raw: node,
        isLeaf: !(hasChildren && node.children.length > 0),
        ...(node.pos ? { pos: node.pos } : {})
      });
    }
  }
  walk(models, '');
  return out;
}

/**
 * Bind the `@param` blocks of a doc comment against an explicit signature model.
 *
 * Rules (see param-binder/README.md):
 *  - Leaf parameters without a matching `@param` are "missing". A parameter is
 *    never exempt just because it is optional.
 *  - `@param` paths that match no modeled path are "extra". Sub-paths written
 *    under a parameter whose model has NO `children` are "unknown" (the
 *    destructuring model was not provided; names are not guessed).
 *  - Repeated `@param` paths are "duplicate" and BOTH written positions are
 *    reported (plus the model position when one exists).
 *  - Every produced binding/diagnostic keeps its original source positions.
 *
 * @param {SignatureModel} signature
 * @param {string} docComment
 * @returns {BindResult}
 */
function bindParamDocs(signature, docComment) {
  if (!signature || !Array.isArray(signature.params)) {
    throw new TypeError('bindParamDocs(): signature.params must be an array');
  }

  const flat = flattenParameters(signature.params);
  /** @type {Map<string, FlatParam>} */
  const byPath = new Map();
  /** @type {Diagnostic[]} */
  const diagnostics = [];

  // Defensive: a duplicated path in the supplied model is a model error, not
  // something the binder should silently pick one side of.
  for (const item of flat) {
    if (byPath.has(item.path)) {
      diagnostics.push({
        code: 'duplicate',
        message: 'signature model declares path "' + item.path + '" more than once',
        positions: [byPath.get(item.path).pos, item.pos].filter(Boolean)
      });
    } else {
      byPath.set(item.path, item);
    }
  }

  const parsed = parseDocComment(docComment);
  for (const m of parsed.malformed) {
    diagnostics.push({
      code: 'malformed',
      message: m.message,
      positions: [m.pos]
    });
  }

  /** @type {Map<string, ParamBlock[]>} */
  const docsByPath = new Map();
  for (const block of parsed.params) {
    const list = docsByPath.get(block.path);
    if (list) {
      list.push(block);
    } else {
      docsByPath.set(block.path, [block]);
    }
  }

  /** @type {ParamBinding[]} */
  const bindings = [];

  // 1. Duplicate @param paths: report every written location (both spots).
  for (const [path, blocks] of docsByPath) {
    if (blocks.length > 1) {
      const model = byPath.get(path);
      diagnostics.push({
        code: 'duplicate',
        message:
          '@param "' + path + '" is documented ' + blocks.length + ' times;' +
          ' each parameter path must have exactly one @param block',
        positions: blocks
          .map((b) => b.namePos)
          .concat(model && model.pos ? [model.pos] : [])
      });
    }
  }

  // 2. Bind or classify every written block.
  for (const [path, blocks] of docsByPath) {
    const first = blocks[0];
    const model = byPath.get(path);
    if (model) {
      bindings.push({ path, doc: first, model });
      continue;
    }

    const parentPath = first.segments.length > 1
      ? first.segments.slice(0, -1).join('.')
      : undefined;
    const parent = parentPath ? byPath.get(parentPath) : undefined;

    if (parent && !parent.raw.children) {
      // The parent exists but its destructuring model was not provided.
      diagnostics.push({
        code: 'unknown',
        message:
          '@param "' + path + '" cannot be bound: "' + parentPath + '" has no' +
          ' destructuring model (no "children" supplied, so names are not guessed)',
        positions: [first.namePos].concat(parent.pos ? [parent.pos] : [])
      });
    } else {
      diagnostics.push({
        code: 'extra',
        message: '@param "' + path + '" does not match any parameter of the signature',
        positions: [first.namePos]
      });
    }
  }

  // 3. Missing documentation. A parent with modeled children is documented via
  //    its leaves; the leaves themselves (optional ones included) are required.
  const documented = new Set(docsByPath.keys());
  for (const item of flat) {
    if (!item.isLeaf || documented.has(item.path)) {
      continue;
    }
    diagnostics.push({
      code: 'missing',
      message:
        'parameter "' + item.path + '" is missing a @param description' +
        (item.raw.optional ? ' (optional parameters still require documentation)' : ''),
      positions: item.pos ? [item.pos] : []
    });
  }

  // Deterministic ordering: by first position offset, then code, then message.
  const codeOrder = { missing: 0, duplicate: 1, unknown: 2, extra: 3, malformed: 4 };
  diagnostics.sort((d1, d2) => {
    const o1 = d1.positions[0] ? d1.positions[0].offset : Number.MAX_SAFE_INTEGER;
    const o2 = d2.positions[0] ? d2.positions[0].offset : Number.MAX_SAFE_INTEGER;
    if (o1 !== o2) {
      return o1 - o2;
    }
    if (codeOrder[d1.code] !== codeOrder[d2.code]) {
      return codeOrder[d1.code] - codeOrder[d2.code];
    }
    return d1.message.localeCompare(d2.message);
  });
  bindings.sort((b1, b2) => b1.path.localeCompare(b2.path));

  const result = { bindings, diagnostics, ok: diagnostics.length === 0 };
  return result;
}

/**
 * Render a signature model as source-like text. Default expressions are shown
 * verbatim and never evaluated.
 *
 * @param {SignatureModel} signature
 * @returns {string}
 */
function renderSignature(signature) {
  /**
   * @param {ParamModel[]} list
   * @param {string} indent
   */
  function renderList(list, indent) {
    return list
      .map((p) => {
        const name = p.optional ? p.name + '?' : p.name;
        const def = p.defaultExpression !== undefined ? ' = ' + p.defaultExpression : '';
        if (Array.isArray(p.children) && p.children.length > 0) {
          return name + def + ': {\n' + renderList(p.children, indent + '  ') + '\n' + indent + '}';
        }
        return name + def;
      })
      .map((s) => indent + s)
      .join(',\n');
  }
  const body = renderList(signature.params, '  ');
  return 'function ' + (signature.name || 'f') + '(\n' + body + '\n)';
}

/**
 * Human-readable report of a bind result.
 *
 * @param {BindResult} result
 * @returns {string}
 */
function formatReport(result) {
  const lines = [];
  if (result.bindings.length > 0) {
    lines.push('Bound @param blocks:');
    for (const b of result.bindings) {
      lines.push('  - ' + b.path + '  <-  @param @ ' + formatPos(b.doc.namePos));
    }
  }
  if (result.diagnostics.length > 0) {
    lines.push('Diagnostics:');
    for (const d of result.diagnostics) {
      const where = d.positions.map(formatPos).join(' , ');
      lines.push('  [' + d.code + '] ' + d.message + (where ? '  @ ' + where : ''));
    }
  } else {
    lines.push('No diagnostics.');
  }
  return lines.join('\n');
}

module.exports = {
  bindParamDocs,
  flattenParameters,
  renderSignature,
  formatReport
};
