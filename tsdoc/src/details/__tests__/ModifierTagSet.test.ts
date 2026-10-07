// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import {
  type DocComment,
  type ParserContext,
  DocBlockTag,
  DocNode,
  TSDocConfiguration,
  TSDocParser,
  TSDocTagDefinition,
  TSDocTagSyntaxKind,
  TSDocMessageId
} from '../../index';

function parseDocComment(input: string, configuration?: TSDocConfiguration): ParserContext {
  const tsdocParser: TSDocParser = new TSDocParser(configuration);
  return tsdocParser.parseString(input);
}

test('01 Modifier tags preserve their original order, including duplicates', () => {
  const configuration: TSDocConfiguration = new TSDocConfiguration();
  configuration.addTagDefinitions([
    new TSDocTagDefinition({
      tagName: '@customModifier',
      syntaxKind: TSDocTagSyntaxKind.ModifierTag
    })
  ]);

  const parserContext: ParserContext = parseDocComment(
    [
      '/**',
      ' * Summary.',
      ' *',
      ' * @customModifier @beta @internal @customModifier @beta @alpha',
      ' */'
    ].join('\n'),
    configuration
  );

  const docComment: DocComment = parserContext.docComment;

  // The original-order view preserves every occurrence, in encounter order,
  // for both built-in and custom (configuration-registered) modifiers.
  expect(docComment.modifierTagSet.nodesInOrder.map((node) => node.tagName)).toEqual([
    '@customModifier',
    '@beta',
    '@internal',
    '@customModifier',
    '@beta',
    '@alpha'
  ]);

  // The classic set view remains deduplicated, keeping the first occurrence.
  expect(docComment.modifierTagSet.nodes.map((node) => node.tagName)).toEqual([
    '@customModifier',
    '@beta',
    '@internal',
    '@alpha'
  ]);

  // Duplicates are retained separately for diagnostics.
  expect(docComment.modifierTagSet.duplicateNodes.map((node) => node.tagName)).toEqual([
    '@customModifier',
    '@beta'
  ]);

  // Every duplicate also appears in the original-order view.
  for (const duplicate of docComment.modifierTagSet.duplicateNodes) {
    expect(docComment.modifierTagSet.nodesInOrder).toContain(duplicate);
  }

  // Set queries continue to work against the deduplicated set.
  expect(docComment.modifierTagSet.isAlpha()).toEqual(true);
  expect(docComment.modifierTagSet.isBeta()).toEqual(true);
  expect(docComment.modifierTagSet.isInternal()).toEqual(true);
  expect(docComment.modifierTagSet.isPublic()).toEqual(false);
  expect(docComment.modifierTagSet.hasTagName('@customModifier')).toEqual(true);
  expect(docComment.modifierTagSet.hasTagName('@unknownTag')).toEqual(false);
});

test('02 Unknown tags are never treated as modifiers', () => {
  const parserContext: ParserContext = parseDocComment(
    ['/**', ' * Summary.', ' *', ' * @unknownTag @beta', ' */'].join('\n')
  );

  const docComment: DocComment = parserContext.docComment;

  // The unknown tag must not masquerade as a modifier in any of the views.
  expect(docComment.modifierTagSet.nodesInOrder.map((node) => node.tagName)).toEqual(['@beta']);
  expect(docComment.modifierTagSet.nodes.map((node) => node.tagName)).toEqual(['@beta']);
  expect(docComment.modifierTagSet.duplicateNodes).toEqual([]);
  expect(docComment.modifierTagSet.hasTagName('@unknownTag')).toEqual(false);

  // The parser reports the unknown tag as a diagnostic instead.
  expect(
    parserContext.log.messages.some((message) => message.messageId === TSDocMessageId.UndefinedTag)
  ).toEqual(true);
});

test('03 The original-order view does not modify the AST', () => {
  const parserContext: ParserContext = parseDocComment(
    ['/**', ' * Summary.', ' *', ' * @beta @internal @beta', ' */'].join('\n')
  );

  const docComment: DocComment = parserContext.docComment;

  // DocComment child nodes are still built from the deduplicated set.
  const modifierChildren: string[] = docComment
    .getChildNodes()
    .filter((node: DocNode) => node instanceof DocBlockTag)
    .map((node: DocNode) => (node as DocBlockTag).tagName);
  expect(modifierChildren).toEqual(['@beta', '@internal']);

  // Emitting the comment is unaffected by the retained duplicates.
  const emitted: string = docComment.emitAsTsdoc();
  expect(emitted.match(/@beta/g)).toHaveLength(1);
  expect(emitted).toContain('@internal');
});
