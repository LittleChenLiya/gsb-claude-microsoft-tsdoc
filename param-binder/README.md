# Explicit `@param` Documentation Binder

This package binds the `@param` blocks of a TSDoc/JSDoc doc comment to the
**actual parameter list of a function**, given a small, explicit **signature
model**. Destructuring paths such as `options.x` are matched by the exact path
written in the comment against paths listed explicitly in the model — the
binder never guesses destructured names from source text or types.

The implementation is deliberately self-contained:

- Pure Node.js, **zero dependencies** and **no build step**.
- It **never executes the documented function**.
- It **does not read a TypeScript checker project** or analyze full program
  types; only the signature model handed to it is used.
- Default expressions are **displayed only**; they are copied verbatim into
  rendered signatures and reports and are **never evaluated**.
- Source positions from both the comment and the model are preserved on every
  binding and diagnostic.

## Layout

| File | Purpose |
| --- | --- |
| `src/binder.js` | Model-driven binding, diagnostics and signature rendering. |
| `src/docCommentParser.js` | Small line scanner that extracts `@param` blocks and positions from a raw doc comment. |
| `src/positions.js` | Offset/line/column mapping and source position helpers. |
| `src/examples.js` | The two worked signature examples (runnable). |
| `test/binder.test.js` | Deterministic, dependency-free acceptance tests. |

## Run

From this folder (`param-binder/`):

```bash
# Worked examples (two signatures)
node src/examples.js
# or
npm run example

# Deterministic test suite
node test/binder.test.js
# or
npm test
```

## Signature model

The caller provides the signature; the binder never constructs one from source
or types:

```ts
interface ParamModel {
  name: string;                  // binding name at this level
  optional?: boolean;            // does NOT waive the documentation requirement
  defaultExpression?: string;    // verbatim source text; shown, never evaluated
  pos?: SourcePos;               // declaration position in the signature source
  children?: ParamModel[];       // EXPLICIT destructuring model
}

interface SignatureModel {
  name?: string;
  params: ParamModel[];
}
```

`children` is the only source of destructured names:

- `children` **present** (even `[]`) → destructuring is modeled explicitly; the
  binder walks exactly those children.
- `children` **absent** and the comment writes a sub-path such as
  `settings.mode` → the path is reported as **`unknown`** rather than guessed.

Dotted paths are formed by joining `children` names (`options.x`,
`options.x.y`, ...) and compared exactly against the path written after
`@param`.

## Binding rules and diagnostics

| Code | When | Positions reported |
| --- | --- | --- |
| `missing` | A modeled **leaf** parameter has no `@param` block. Parent objects with modeled children are documented through their leaves; documenting the parent itself is also allowed. | Declaration position from the model, if provided |
| `extra` | A `@param` path matches no modeled parameter path and is not a sub-path of an unmodeled-destructuring parent (e.g. `options.y` when only `options.x` exists). | The written `@param` position |
| `unknown` | A sub-path is written under a parameter whose model has **no `children`** (destructuring not provided; names are not guessed). | The written `@param` position and the parent's model position |
| `duplicate` | The same `@param` path is written more than once. **Both written positions** are reported, together with the model declaration position when known. | Every `@param` write + model position |
| `malformed` | The `@param` header has no path, an unclosed `{type}`/`[name]`, or a path that is not a dotted identifier. | The offending tag position |

Notes:

- **Optional parameters are not automatically allowed to lack documentation.**
  Every leaf still requires a `@param`; optional-but-undocumented is `missing`.
- The first occurrence of a duplicated path is still included in `bindings`;
  the duplication itself is reported with all locations.
- Results are sorted deterministically by source offset so reports are stable.

## Example output

`node src/examples.js` runs two signatures.

**Example 1 — `drawChart(a, options: { x })`** demonstrates separate binding of
`a` and `options.x`, an `extra` `options.y`, and a duplicated `a` reported at
both comment locations plus the model position:

```text
Bound @param blocks:
  - a  <-  @param @ 4:11
  - options.x  <-  @param @ 5:11
Diagnostics:
  [duplicate] @param "a" is documented 2 times; ...  @ 4:11 , 7:11 , drawChart.ts:3:3
  [extra] @param "options.y" does not match any parameter of the signature  @ 6:11
```

**Example 2 — `configure(name, timeout?, settings, retry?)`** demonstrates that
an optional `timeout` with a default expression (`sentinelDefault()`) is still
`missing` when undocumented, that `settings.mode` is `unknown` because no
destructuring model was supplied for `settings`, and that the default
expression is displayed (`timeout? = sentinelDefault()`) but provably never
evaluated:

```text
  [missing] parameter "timeout" is missing a @param description
            (optional parameters still require documentation)  @ configure.ts:4:3
  [unknown] @param "settings.mode" cannot be bound: "settings" has no
            destructuring model (no "children" supplied, so names are not guessed) ...

default expression evaluated by binder? no (display only)
```

## Programmatic use

```js
const { bindParamDocs, formatReport } = require('./src/binder');

const signature = {
  name: 'drawChart',
  params: [
    { name: 'a', pos: /* SourcePos from your source map */ },
    { name: 'options', children: [{ name: 'x' }, { name: 'y' }] }
  ]
};

const result = bindParamDocs(signature, docCommentText);
// result.bindings    -> [{ path, doc, model }]
// result.diagnostics -> [{ code, message, positions: SourcePos[] }]
// result.ok          -> true when there are no diagnostics
console.log(formatReport(result));
```
