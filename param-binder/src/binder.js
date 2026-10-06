'use strict';

/**
 * Explicit @param documentation binder.
 *
 * Binds DocComment `@param` entries to an explicitly provided signature
 * model. The binder never guesses parameter names, never executes the
 * documented function, never evaluates default expressions, and never
 * consults a type checker -- it only matches the two provided models.
 *
 * Issue kinds:
 *  - "missing":   a model parameter path has no matching @param doc.
 *                 Optional parameters are NOT exempt from documentation.
 *  - "extra":     a @param doc path cannot be bound to anything in the
 *                 provided model (多余说明).
 *  - "duplicate": the same doc path is written more than once; the issue
 *                 reports the source locations of ALL occurrences.
 *  - "unknown":   the doc path goes below a destructured parameter whose
 *                 child model was NOT provided (children === null). The
 *                 binder refuses to guess and marks the path unknown.
 */

/**
 * Flatten the provided signature model into a path -> node map.
 * Only paths explicitly present in the model are returned; nothing is
 * inferred. Default expressions are carried through as raw source text.
 *
 * @param {object} model - provided signature model
 * @returns {Map<string, object>} path -> param node
 */
function flattenModel(model) {
  const map = new Map();

  const visit = (node, parentPath) => {
    const path = parentPath ? `${parentPath}.${node.name}` : (node.path || node.name);
    const destructured = node.destructured === true;
    // children: array => explicit child model; null/undefined => not provided
    const hasChildModel = Array.isArray(node.children);
    const entry = {
      path,
      optional: node.optional === true,
      // Raw default expression text. Displayed only, NEVER evaluated.
      default: typeof node.default === 'string' ? node.default : null,
      destructured,
      childrenProvided: hasChildModel,
      // Source path mapping is preserved verbatim from the model.
      loc: node.loc || null
    };
    map.set(path, entry);
    if (hasChildModel) {
      for (const child of node.children) {
        visit(child, path);
      }
    }
  };

  for (const param of model.params || []) {
    visit(param, null);
  }
  return map;
}

/**
 * Find the nearest ancestor path of `docPath` that exists in the model.
 * "options.x.y" -> tries "options.x", then "options".
 */
function nearestModelAncestor(docPath, modelMap) {
  let cursor = docPath;
  while (cursor.includes('.')) {
    cursor = cursor.slice(0, cursor.lastIndexOf('.'));
    if (modelMap.has(cursor)) {
      return modelMap.get(cursor);
    }
  }
  return null;
}

/**
 * Bind doc params to the provided signature model.
 *
 * @param {object} model - provided signature model (see examples/)
 * @param {object} doc   - provided DocComment model: { params: [{path, text, loc}] }
 * @returns {{functionName: string|null, bindings: Array, issues: Array, ok: boolean}}
 */
function bindParams(model, doc) {
  const modelMap = flattenModel(model);
  const issues = [];
  const bindings = [];
  const seenDocPaths = new Map(); // path -> first doc entry

  for (const entry of doc.params || []) {
    const path = entry.path;
    const loc = entry.loc || null;

    if (seenDocPaths.has(path)) {
      // Duplicate path: report BOTH source positions.
      const first = seenDocPaths.get(path);
      issues.push({
        kind: 'duplicate',
        path,
        message: `Duplicate @param documentation for "${path}" (reported at both positions).`,
        locs: [first.loc || null, loc]
      });
      continue;
    }
    seenDocPaths.set(path, entry);

    const target = modelMap.get(path);
    if (target) {
      bindings.push({
        path,
        doc: { text: entry.text || '', loc },
        param: {
          loc: target.loc,
          optional: target.optional,
          // Raw text, display only -- never evaluated.
          default: target.default
        }
      });
      continue;
    }

    const ancestor = nearestModelAncestor(path, modelMap);
    if (ancestor && ancestor.destructured && !ancestor.childrenProvided) {
      // Destructured parameter whose child model was NOT provided:
      // mark unknown instead of guessing child names.
      issues.push({
        kind: 'unknown',
        path,
        message: `Cannot verify "${path}": destructured parameter "${ancestor.path}" has no provided child model.`,
        locs: [loc]
      });
    } else {
      // No bindable target at all -> extra documentation (多余说明).
      issues.push({
        kind: 'extra',
        path,
        message: `Extra @param documentation for "${path}": no such parameter path in the provided signature model.`,
        locs: [loc]
      });
    }
  }

  // Missing docs: every leaf parameter path requires documentation,
  // including optional parameters and parameters with defaults.
  const documentedPaths = new Set(bindings.map((b) => b.path));
  for (const [path, node] of modelMap) {
    const isLeaf = !node.childrenProvided;
    if (!isLeaf) {
      continue; // destructured parents are documented via their children
    }
    if (!documentedPaths.has(path)) {
      issues.push({
        kind: 'missing',
        path,
        message: `Missing @param documentation for "${path}"` +
          (node.optional ? ' (optional parameters still require documentation).' : '.'),
        locs: [node.loc]
      });
    }
  }

  const isError = (issue) => issue.kind !== 'unknown';
  return {
    functionName: model.functionName || null,
    source: model.source || null,
    bindings,
    issues,
    ok: !issues.some(isError)
  };
}

module.exports = { bindParams, flattenModel };
