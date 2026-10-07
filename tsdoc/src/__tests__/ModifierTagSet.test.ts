// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import {
  DocBlockTag,
  type DocComment,
  type DocNode,
  ModifierTagSet,
  type ParserContext,
  StandardTags,
  TSDocConfiguration,
  TSDocMessageId,
  TSDocParser,
  TSDocTagDefinition,
  TSDocTagSyntaxKind
} from '../index';

function createConfigurationWithCustomModifier(): TSDocConfiguration {
  const configuration: TSDocConfiguration = new TSDocConfiguration();
  configuration.addTagDefinitions([
    new TSDocTagDefinition({
      tagName: '@customModifier',
      syntaxKind: TSDocTagSyntaxKind.ModifierTag
    })
  ]);
  return configuration;
}

// A small in-memory fixture exercising built-in modifiers, a custom modifier,
// duplicate occurrences, and an unknown tag.
const FIXTURE: string = [
  '/**',
  ' * Summary.',
  ' *',
  ' * @public @customModifier @internal @public @unknownTag @customModifier',
  ' */'
].join('\n');

function parseFixture(configuration?: TSDocConfiguration): ParserContext {
  const tsdocParser: TSDocParser = new TSDocParser(
    configuration ?? createConfigurationWithCustomModifier()
  );
  return tsdocParser.parseString(FIXTURE);
}

test('01 Modifier tags are readable in their original order, including duplicates', () => {
  const parserContext: ParserContext = parseFixture();
  const modifierTagSet: ModifierTagSet = parserContext.docComment.modifierTagSet;

  // The ordered view preserves the exact sequence from the source comment.
  expect(modifierTagSet.orderedNodes.map((x) => x.tagName)).toEqual([
    '@public',
    '@customModifier',
    '@internal',
    '@public',
    '@customModifier'
  ]);

  // The unknown tag must not masquerade as a modifier.
  expect(modifierTagSet.orderedNodes.map((x) => x.tagName)).not.toContain('@unknownTag');
});

test('02 Set queries remain deduplicated', () => {
  const parserContext: ParserContext = parseFixture();
  const modifierTagSet: ModifierTagSet = parserContext.docComment.modifierTagSet;

  // The classic `nodes` view keeps only the first occurrence of each tag.
  expect(modifierTagSet.nodes.map((x) => x.tagName)).toEqual([
    '@public',
    '@customModifier',
    '@internal'
  ]);

  expect(modifierTagSet.hasTagName('@public')).toEqual(true);
  expect(modifierTagSet.hasTagName('@customModifier')).toEqual(true);
  expect(modifierTagSet.hasTagName('@unknownTag')).toEqual(false);
  expect(modifierTagSet.hasTag(StandardTags.internal)).toEqual(true);
  expect(modifierTagSet.hasTag(StandardTags.beta)).toEqual(false);

  // tryGetTag() returns the first occurrence that was added.
  const firstPublic: DocBlockTag = modifierTagSet.orderedNodes[0];
  expect(modifierTagSet.tryGetTag(StandardTags.public)).toBe(firstPublic);
  expect(modifierTagSet.nodes[0]).toBe(firstPublic);
});

test('03 Duplicate occurrences are preserved separately for diagnostics', () => {
  const parserContext: ParserContext = parseFixture();
  const modifierTagSet: ModifierTagSet = parserContext.docComment.modifierTagSet;

  expect(modifierTagSet.duplicateNodes.map((x) => x.tagName)).toEqual(['@public', '@customModifier']);

  // The duplicates are the occurrences skipped by the deduplicated `nodes` view.
  expect(modifierTagSet.duplicateNodes[0]).toBe(modifierTagSet.orderedNodes[3]);
  expect(modifierTagSet.duplicateNodes[1]).toBe(modifierTagSet.orderedNodes[4]);
});

test('04 Unknown tags are reported and are not treated as modifiers', () => {
  const parserContext: ParserContext = parseFixture();
  const docComment: DocComment = parserContext.docComment;

  const undefinedTagMessages = parserContext.log.messages.filter(
    (x) => x.messageId === TSDocMessageId.UndefinedTag
  );
  expect(undefinedTagMessages.map((x) => x.unformattedText)).toEqual([
    'The TSDoc tag "@unknownTag" is not defined in this configuration'
  ]);

  // The unknown tag stays in the DocNode tree as an ordinary block tag...
  const blockTagsInTree: DocBlockTag[] = [];
  const visit = (node: DocNode): void => {
    for (const child of node.getChildNodes()) {
      if (child === undefined) {
        continue;
      }
      if (child instanceof DocBlockTag) {
        blockTagsInTree.push(child);
      }
      visit(child);
    }
  };
  visit(docComment);
  expect(blockTagsInTree.map((x) => x.tagName)).toContain('@unknownTag');

  // ...but it never enters the modifier tag set.
  expect(docComment.modifierTagSet.hasTagName('@unknownTag')).toEqual(false);
});

test('05 Custom modifiers require configuration registration', () => {
  // Parse the same fixture with the default configuration, which does not
  // define `@customModifier`.
  const parserContext: ParserContext = parseFixture(new TSDocConfiguration());
  const modifierTagSet: ModifierTagSet = parserContext.docComment.modifierTagSet;

  expect(modifierTagSet.orderedNodes.map((x) => x.tagName)).toEqual(['@public', '@internal', '@public']);
  expect(modifierTagSet.hasTagName('@customModifier')).toEqual(false);
  expect(
    parserContext.log.messages
      .filter((x) => x.messageId === TSDocMessageId.UndefinedTag)
      .map((x) => x.unformattedText)
  ).toEqual([
    'The TSDoc tag "@customModifier" is not defined in this configuration',
    'The TSDoc tag "@unknownTag" is not defined in this configuration',
    'The TSDoc tag "@customModifier" is not defined in this configuration'
  ]);
});

test('06 The ordered view does not change the DocNode tree or emitted TSDoc', () => {
  const parserContext: ParserContext = parseFixture();
  const docComment: DocComment = parserContext.docComment;

  // The DocComment child nodes expose only the deduplicated modifier tags.
  const modifierChildren: DocBlockTag[] = docComment
    .getChildNodes()
    .filter((x): x is DocBlockTag => x instanceof DocBlockTag);
  expect(modifierChildren.map((x) => x.tagName)).toEqual(['@public', '@customModifier', '@internal']);

  // The emitted comment contains each modifier exactly once.
  const emitted: string = docComment.emitAsTsdoc();
  for (const tagName of ['@public', '@customModifier', '@internal']) {
    expect(emitted.split(tagName).length - 1).toEqual(1);
  }
});

test('07 ModifierTagSet.addTag() tracks order and duplicates', () => {
  const configuration: TSDocConfiguration = new TSDocConfiguration();
  const set: ModifierTagSet = new ModifierTagSet();

  const tag1: DocBlockTag = new DocBlockTag({ configuration, tagName: '@alpha' });
  const tag2: DocBlockTag = new DocBlockTag({ configuration, tagName: '@beta' });
  // Same tag name with different casing counts as a duplicate.
  const tag3: DocBlockTag = new DocBlockTag({ configuration, tagName: '@Alpha' });

  expect(set.addTag(tag1)).toEqual(true);
  expect(set.addTag(tag2)).toEqual(true);
  expect(set.addTag(tag3)).toEqual(false);

  expect(set.orderedNodes).toEqual([tag1, tag2, tag3]);
  expect(set.nodes).toEqual([tag1, tag2]);
  expect(set.duplicateNodes).toEqual([tag3]);

  // Set queries are case-insensitive and see the deduplicated view.
  expect(set.hasTagName('@ALPHA')).toEqual(true);
  expect(set.tryGetTag(StandardTags.alpha)).toBe(tag1);
});
