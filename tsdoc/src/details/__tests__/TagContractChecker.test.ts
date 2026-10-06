// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { TSDocConfiguration } from '../../configuration/TSDocConfiguration';
import { TSDocTagDefinition, TSDocTagSyntaxKind } from '../../configuration/TSDocTagDefinition';
import { TSDocParser } from '../../parser/TSDocParser';
import { TSDocMessageId } from '../../parser/TSDocMessageId';
import type { ParserContext } from '../../parser/ParserContext';
import { DocNode, type IDocNodeParameters } from '../../nodes/DocNode';
import {
  TagContractChecker,
  TagContractDiagnosticId,
  type ITagContractDiagnostic
} from '../TagContractChecker';

/**
 * Builds a configuration with an explicit tag contract:
 *
 * - `@defaultValue` is a unique block tag; `@default` is an alias that shares its identity
 * - `@badge` is a unique inline tag
 * - `@owned` is a unique modifier tag
 * - `@section` is a unique block tag
 * - `@note` is a block tag that allows multiple occurrences
 */
function createConfiguration(): TSDocConfiguration {
  const configuration: TSDocConfiguration = new TSDocConfiguration();
  configuration.clear(/* noStandardTags */ true);
  configuration.addTagDefinitions([
    new TSDocTagDefinition({
      tagName: '@defaultValue',
      syntaxKind: TSDocTagSyntaxKind.BlockTag,
      aliases: ['@default']
    }),
    new TSDocTagDefinition({
      tagName: '@badge',
      syntaxKind: TSDocTagSyntaxKind.InlineTag
    }),
    new TSDocTagDefinition({
      tagName: '@owned',
      syntaxKind: TSDocTagSyntaxKind.ModifierTag
    }),
    new TSDocTagDefinition({
      tagName: '@section',
      syntaxKind: TSDocTagSyntaxKind.BlockTag
    }),
    new TSDocTagDefinition({
      tagName: '@note',
      syntaxKind: TSDocTagSyntaxKind.BlockTag,
      allowMultiple: true
    })
  ]);
  // The contract checker (not the parser) is responsible for reporting unknown tags
  configuration.validation.ignoreUndefinedTags = true;
  return configuration;
}

function parseAndCheck(buffer: string, configuration: TSDocConfiguration): ITagContractDiagnostic[] {
  const tsdocParser: TSDocParser = new TSDocParser(configuration);
  const parserContext: ParserContext = tsdocParser.parseString(buffer);
  const checker: TagContractChecker = new TagContractChecker(configuration);
  return checker.check(parserContext.docComment);
}

/**
 * The four-comment example set for the tag contract checker:
 *
 * - comment 1: an inline tag in a block position (category error)
 * - comment 2: two occurrences of a unique tag (both are reported)
 * - comment 3: "@" tags inside code spans and fenced code do not participate
 * - comment 4: aliases share one identity, so duplicates are checked by canonical name
 */
const exampleComment1: string = ['/**', ' * Summary text.', ' * @badge', ' */'].join('\n');

const exampleComment2: string = [
  '/**',
  ' * Summary text.',
  ' * @defaultValue 1',
  ' * @defaultValue 2',
  ' */'
].join('\n');

const exampleComment3: string = [
  '/**',
  ' * Use `@defaultValue 1` in your code, for example:',
  ' * ```',
  ' * const x = `@defaultValue 2`;',
  ' * @defaultValue notATag',
  ' * ```',
  ' * @defaultValue 3',
  ' */'
].join('\n');

const exampleComment4: string = [
  '/**',
  ' * Summary text.',
  ' * @defaultValue 1',
  ' * @default 2',
  ' */'
].join('\n');

test('four-comment example 1: an inline tag in a block position reports a category error', () => {
  const configuration: TSDocConfiguration = createConfiguration();
  const diagnostics: ITagContractDiagnostic[] = parseAndCheck(exampleComment1, configuration);

  expect(diagnostics.map((x) => x.messageId)).toEqual([TagContractDiagnosticId.InlineTagInBlockPosition]);
  expect(diagnostics[0].tagName).toEqual('@badge');
  expect(diagnostics[0].canonicalTagName).toEqual('@badge');
  // The diagnostic preserves the range of the tag in the original comment
  expect(diagnostics[0].textRange.toString()).toEqual('@badge');
  expect(diagnostics[0].textRange.pos).toEqual(exampleComment1.indexOf('@badge'));
});

test('four-comment example 2: two occurrences of a unique tag report both occurrences', () => {
  const configuration: TSDocConfiguration = createConfiguration();
  const diagnostics: ITagContractDiagnostic[] = parseAndCheck(exampleComment2, configuration);

  expect(diagnostics.map((x) => x.messageId)).toEqual([
    TagContractDiagnosticId.DuplicateUniqueTag,
    TagContractDiagnosticId.DuplicateUniqueTag
  ]);
  // Both occurrences are reported, in the order they appear in the original comment
  const firstPos: number = exampleComment2.indexOf('@defaultValue');
  const secondPos: number = exampleComment2.indexOf('@defaultValue', firstPos + 1);
  expect(diagnostics[0].textRange.pos).toEqual(firstPos);
  expect(diagnostics[1].textRange.pos).toEqual(secondPos);
  expect(diagnostics[0].textRange.toString()).toEqual('@defaultValue');
  expect(diagnostics[1].textRange.toString()).toEqual('@defaultValue');
  expect(diagnostics[0].messageText).toContain('appears 2 times');
});

test('four-comment example 3: "@" tags inside code spans and fenced code do not participate', () => {
  const configuration: TSDocConfiguration = createConfiguration();
  const diagnostics: ITagContractDiagnostic[] = parseAndCheck(exampleComment3, configuration);

  // The comment mentions "@defaultValue" inside a code span and inside a fenced code
  // block, but the only real tag is the final "@defaultValue 3" block, which appears
  // exactly once.  So there is nothing to report.
  expect(diagnostics).toEqual([]);
});

test('four-comment example 4: aliases share one identity and are checked by canonical name', () => {
  const configuration: TSDocConfiguration = createConfiguration();

  // The alias resolves to the same definition object as the canonical tag name
  const canonicalDefinition: TSDocTagDefinition | undefined = configuration.tryGetTagDefinition('@defaultValue');
  expect(canonicalDefinition).toBeDefined();
  expect(configuration.tryGetTagDefinition('@default')).toBe(canonicalDefinition);
  expect(canonicalDefinition!.aliases).toEqual(['@default']);

  const diagnostics: ITagContractDiagnostic[] = parseAndCheck(exampleComment4, configuration);

  // "@defaultValue" and its alias "@default" are duplicates of the same unique tag;
  // both occurrences are reported
  expect(diagnostics.map((x) => x.messageId)).toEqual([
    TagContractDiagnosticId.DuplicateUniqueTag,
    TagContractDiagnosticId.DuplicateUniqueTag
  ]);
  // The canonical identity is unified, but the original spelling is preserved
  expect(diagnostics[0].tagName).toEqual('@defaultValue');
  expect(diagnostics[0].canonicalTagName).toEqual('@defaultValue');
  expect(diagnostics[1].tagName).toEqual('@default');
  expect(diagnostics[1].canonicalTagName).toEqual('@defaultValue');
  expect(diagnostics[1].textRange.toString()).toEqual('@default');
  expect(diagnostics[1].messageText).toContain('"@default" is an alias of "@defaultValue"');
});

test('a block tag in an inline position reports a category error', () => {
  const configuration: TSDocConfiguration = createConfiguration();
  const buffer: string = ['/**', ' * Summary {@section inline} text.', ' */'].join('\n');
  const diagnostics: ITagContractDiagnostic[] = parseAndCheck(buffer, configuration);

  expect(diagnostics.map((x) => x.messageId)).toEqual([TagContractDiagnosticId.BlockTagInInlinePosition]);
  expect(diagnostics[0].tagName).toEqual('@section');
  expect(diagnostics[0].textRange.toString()).toEqual('@section');
});

test('a modifier tag in an inline position reports a category error', () => {
  const configuration: TSDocConfiguration = createConfiguration();
  const buffer: string = ['/**', ' * Summary {@owned} text.', ' */'].join('\n');
  const diagnostics: ITagContractDiagnostic[] = parseAndCheck(buffer, configuration);

  expect(diagnostics.map((x) => x.messageId)).toEqual([
    TagContractDiagnosticId.ModifierTagInInlinePosition
  ]);
  expect(diagnostics[0].tagName).toEqual('@owned');
});

test('a modifier tag must appear after the block tags', () => {
  const configuration: TSDocConfiguration = createConfiguration();
  const misplaced: string = ['/**', ' * Summary.', ' * @owned', ' * @section details', ' */'].join('\n');
  const diagnostics: ITagContractDiagnostic[] = parseAndCheck(misplaced, configuration);

  expect(diagnostics.map((x) => x.messageId)).toEqual([TagContractDiagnosticId.ModifierTagBeforeBlockTag]);
  expect(diagnostics[0].tagName).toEqual('@owned');
  expect(diagnostics[0].textRange.toString()).toEqual('@owned');

  // The same tags in the correct order produce no diagnostics
  const wellformed: string = ['/**', ' * Summary.', ' * @section details', ' * @owned', ' */'].join('\n');
  expect(parseAndCheck(wellformed, configuration)).toEqual([]);
});

test('unknown tags are reported separately from duplicate unique tags', () => {
  const configuration: TSDocConfiguration = createConfiguration();
  // "@mystery" is not defined; even though it appears twice, it is reported as
  // unknown (twice), never as a duplicate unique tag
  const buffer: string = ['/**', ' * Summary.', ' * @mystery one', ' * @mystery two', ' */'].join('\n');
  const diagnostics: ITagContractDiagnostic[] = parseAndCheck(buffer, configuration);

  expect(diagnostics.map((x) => x.messageId)).toEqual([
    TagContractDiagnosticId.UnknownTag,
    TagContractDiagnosticId.UnknownTag
  ]);
  expect(diagnostics[0].canonicalTagName).toBeUndefined();
  expect(diagnostics[0].tagName).toEqual('@mystery');
  expect(diagnostics[1].tagName).toEqual('@mystery');
});

test('a well-formed comment produces no contract diagnostics', () => {
  const configuration: TSDocConfiguration = createConfiguration();
  const buffer: string = [
    '/**',
    ' * Summary with {@badge inline} and `@section code`.',
    ' * @section details',
    ' * @note one',
    ' * @note two',
    ' * @owned',
    ' */'
  ].join('\n');
  expect(parseAndCheck(buffer, configuration)).toEqual([]);
});

test('the contract check does not execute custom tag handlers', () => {
  const configuration: TSDocConfiguration = createConfiguration();

  // A custom DocNode subclass whose constructor counts its invocations; registering
  // a custom node kind is how applications hook custom tag handling into TSDoc
  let customNodeConstructorCount: number = 0;
  class DocCustomNode extends DocNode {
    public constructor(parameters: IDocNodeParameters) {
      super(parameters);
      customNodeConstructorCount++;
    }
    public get kind(): string {
      return 'CustomNode';
    }
  }
  configuration.docNodeManager.registerDocNodes('test', [
    { docNodeKind: 'CustomNode', constructor: DocCustomNode }
  ]);

  const diagnostics: ITagContractDiagnostic[] = parseAndCheck(exampleComment2, configuration);

  // The contract check is a pure inspection of the parsed tree; it never invokes
  // custom tag handlers
  expect(customNodeConstructorCount).toEqual(0);
  expect(diagnostics.map((x) => x.messageId)).toEqual([
    TagContractDiagnosticId.DuplicateUniqueTag,
    TagContractDiagnosticId.DuplicateUniqueTag
  ]);
});

test('the default parser behavior is unchanged by the contract checker', () => {
  const configuration: TSDocConfiguration = createConfiguration();
  const tsdocParser: TSDocParser = new TSDocParser(configuration);
  const parserContext: ParserContext = tsdocParser.parseString(exampleComment1);

  // The parser still reports its own message for an inline tag used as a block tag;
  // the contract diagnostics are only produced by the explicit TagContractChecker phase
  expect(
    parserContext.log.messages.some((message) => message.messageId === TSDocMessageId.InlineTagMissingBraces)
  ).toEqual(true);
  expect(
    parserContext.log.messages.filter((message) => message.messageId.startsWith('tsdoc-contract-'))
  ).toEqual([]);

  // A default configuration (standard tags, no aliases) parses exactly as before
  const defaultParser: TSDocParser = new TSDocParser(new TSDocConfiguration());
  const defaultContext: ParserContext = defaultParser.parseString(
    ['/**', ' * Summary.', ' * @remarks', ' * Details.', ' */'].join('\n')
  );
  expect(defaultContext.log.messages).toEqual([]);
});

test('tag definition aliases are validated and must not collide', () => {
  // Alias spellings must be valid TSDoc tag names
  expect(
    () =>
      new TSDocTagDefinition({
        tagName: '@alpha2',
        syntaxKind: TSDocTagSyntaxKind.BlockTag,
        aliases: ['not-a-tag']
      })
  ).toThrow();

  // An alias must not duplicate the canonical name or another alias
  expect(
    () =>
      new TSDocTagDefinition({
        tagName: '@alpha2',
        syntaxKind: TSDocTagSyntaxKind.BlockTag,
        aliases: ['@ALPHA2']
      })
  ).toThrow();

  // An alias must not collide with another defined tag
  const configuration: TSDocConfiguration = createConfiguration();
  expect(() =>
    configuration.addTagDefinition(
      new TSDocTagDefinition({
        tagName: '@other',
        syntaxKind: TSDocTagSyntaxKind.BlockTag,
        aliases: ['@default']
      })
    )
  ).toThrow();

  // The canonical list of tag definitions is unaffected by aliases
  expect(configuration.tagDefinitions.map((x) => x.tagName)).toEqual([
    '@defaultValue',
    '@badge',
    '@owned',
    '@section',
    '@note'
  ]);
});
