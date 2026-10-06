// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { TSDocParser } from '../TSDocParser';
import { TSDocConfiguration } from '../../configuration/TSDocConfiguration';
import { TSDocTagDefinition, TSDocTagSyntaxKind } from '../../configuration/TSDocTagDefinition';
import { TSDocMessageId } from '../TSDocMessageId';

function parseAndGetMessages(comment: string): string[] {
  const configuration: TSDocConfiguration = new TSDocConfiguration();
  const parser: TSDocParser = new TSDocParser(configuration);
  const parserContext = parser.parseString(comment);
  return parserContext.log.messages.map((message) => message.text);
}

test('00 Inline tag in block position reports the category', () => {
  const messages: string[] = parseAndGetMessages('/**\n * @link\n */');
  expect(messages).toHaveLength(1);
  expect(messages[0]).toMatch(/inline tag/);
  expect(messages[0]).toMatch(/@link/);
});

test('01 Block tag in inline position reports the category', () => {
  const messages: string[] = parseAndGetMessages('/**\n * {@remarks some text}\n */');
  expect(messages).toHaveLength(1);
  expect(messages[0]).toMatch(/block tag/);
  expect(messages[0]).toMatch(/@remarks/);
});

test('02 Modifier tag in inline position reports the category', () => {
  const messages: string[] = parseAndGetMessages('/**\n * {@public}\n */');
  expect(messages).toHaveLength(1);
  expect(messages[0]).toMatch(/modifier tag/);
  expect(messages[0]).toMatch(/@public/);
});

test('03 Two unique block tags report both occurrences', () => {
  const messages: string[] = parseAndGetMessages(
    '/**\n * @remarks first\n *\n * @remarks second\n */'
  );
  expect(messages).toHaveLength(2);
  expect(messages[0]).toMatch(/@remarks/);
  expect(messages[1]).toMatch(/@remarks/);
});

test('04 Two unique modifier tags report both occurrences', () => {
  const messages: string[] = parseAndGetMessages('/**\n * @public\n * @public\n */');
  expect(messages).toHaveLength(2);
  expect(messages[0]).toMatch(/@public/);
  expect(messages[1]).toMatch(/@public/);
});

test('05 Aliases are checked for duplicates by canonical name', () => {
  const messages: string[] = parseAndGetMessages(
    '/**\n * @beta\n * @experimental\n */'
  );
  expect(messages).toHaveLength(2);
  expect(messages[0]).toMatch(/@beta/);
  expect(messages[1]).toMatch(/@experimental/);
});

test('06 Alias alone is accepted and preserves the original spelling', () => {
  const configuration: TSDocConfiguration = new TSDocConfiguration();
  const parser: TSDocParser = new TSDocParser(configuration);
  const parserContext = parser.parseString('/**\n * @experimental\n */');
  expect(parserContext.log.messages).toHaveLength(0);
  expect(parserContext.docComment.modifierTagSet.nodes).toHaveLength(1);
  expect(parserContext.docComment.modifierTagSet.nodes[0].tagName).toBe('@experimental');
});

test('07 Tags inside code spans are not recognized', () => {
  const messages: string[] = parseAndGetMessages(
    '/**\n * Use the `@remarks` tag here.\n */'
  );
  expect(messages).toHaveLength(0);
});

test('08 Tags inside fenced code blocks are not recognized', () => {
  const messages: string[] = parseAndGetMessages(
    '/**\n * Example:\n * ```\n * @remarks not a tag\n * ```\n */'
  );
  expect(messages).toHaveLength(0);
});

test('09 Duplicate and unknown tags are reported separately', () => {
  const configuration: TSDocConfiguration = new TSDocConfiguration();
  const parser: TSDocParser = new TSDocParser(configuration);
  const parserContext = parser.parseString(
    '/**\n * @remarks first\n * @unknownTag\n * @remarks second\n */'
  );
  const messageIds: TSDocMessageId[] = parserContext.log.messages.map(
    (message) => message.messageId
  );
  expect(messageIds).toContain(TSDocMessageId.DuplicateTag);
  expect(messageIds).toContain(TSDocMessageId.UndefinedTag);
  expect(messageIds).toHaveLength(3);
});

test('10 Diagnostics preserve the original comment range', () => {
  const configuration: TSDocConfiguration = new TSDocConfiguration();
  const parser: TSDocParser = new TSDocParser(configuration);
  const parserContext = parser.parseString(
    '/**\n * @remarks first\n *\n * @remarks second\n */'
  );
  const duplicateMessages = parserContext.log.messages.filter(
    (message) => message.messageId === TSDocMessageId.DuplicateTag
  );
  expect(duplicateMessages).toHaveLength(2);
  for (const message of duplicateMessages) {
    expect(message.docNode).toBeDefined();
    expect(message.tokenSequence).toBeDefined();
  }
});

test('11 allowMultiple tags are not reported as duplicates', () => {
  const messages: string[] = parseAndGetMessages(
    '/**\n * @example first\n *\n * @example second\n */'
  );
  expect(messages).toHaveLength(0);
});

test('12 Custom tag definitions are validated without executing handlers', () => {
  const configuration: TSDocConfiguration = new TSDocConfiguration();
  configuration.addTagDefinition(
    new TSDocTagDefinition({
      tagName: '@myCustomTag',
      syntaxKind: TSDocTagSyntaxKind.BlockTag
    })
  );
  const parser: TSDocParser = new TSDocParser(configuration);
  const parserContext = parser.parseString(
    '/**\n * @myCustomTag first\n *\n * @myCustomTag second\n */'
  );
  const duplicateMessages = parserContext.log.messages.filter(
    (message) => message.messageId === TSDocMessageId.DuplicateTag
  );
  expect(duplicateMessages).toHaveLength(2);
});
