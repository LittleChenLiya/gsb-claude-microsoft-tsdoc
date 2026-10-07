// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { TSDocParser } from '../TSDocParser';
import { TSDocConfiguration } from '../../configuration/TSDocConfiguration';
import type { ParserContext } from '../ParserContext';
import type { ParserMessage } from '../ParserMessage';
import type { TextRange } from '../TextRange';
import { TSDocMessageId } from '../TSDocMessageId';
import { DocInlineTag, DocLinkTag, DocNode, DocNodeKind } from '../../nodes';

function parseText(buffer: string): ParserContext {
  const configuration: TSDocConfiguration = new TSDocConfiguration();
  configuration.validation.ignoreUndefinedTags = true;
  const tsdocParser: TSDocParser = new TSDocParser(configuration);
  return tsdocParser.parseString(buffer);
}

function findNodesOfKind(docNode: DocNode, kind: DocNodeKind): DocNode[] {
  const matches: DocNode[] = [];
  const nodesToVisit: DocNode[] = [docNode];
  while (nodesToVisit.length > 0) {
    const node: DocNode = nodesToVisit.pop()!;
    if (node.kind === kind) {
      matches.push(node);
    }
    nodesToVisit.push(...node.getChildNodes());
  }
  return matches;
}

function expectTextRangeSlice(
  textRange: TextRange | undefined,
  buffer: string,
  expectedSlice: string
): TextRange {
  expect(textRange).toBeDefined();
  const definedRange: TextRange = textRange!;
  // The range must reference the original input buffer
  expect(definedRange.buffer).toBe(buffer);
  // Slicing the original input must produce the expected text
  expect(buffer.substring(definedRange.pos, definedRange.end)).toEqual(expectedSlice);
  expect(definedRange.toString()).toEqual(expectedSlice);
  return definedRange;
}

test('00 Inline link with link text: code destination ranges', () => {
  const buffer: string = ['/**', ' * A {@link Button  |  the button  } z', ' */'].join('\n');
  const parserContext: ParserContext = parseText(buffer);
  expect(parserContext.log.messages).toEqual([]);

  const linkTags: DocNode[] = findNodesOfKind(parserContext.docComment, DocNodeKind.LinkTag);
  expect(linkTags).toHaveLength(1);
  const linkTag: DocLinkTag = linkTags[0] as DocLinkTag;

  expect(linkTag.codeDestination).toBeDefined();
  expect(linkTag.linkText).toEqual('the button');

  // The target range excludes the trailing spacing before the "|"
  const targetRange: TextRange = expectTextRangeSlice(linkTag.linkTargetTextRange, buffer, 'Button');
  expect(targetRange.pos).toEqual(buffer.indexOf('Button'));
  expect(targetRange.end).toEqual(buffer.indexOf('Button') + 'Button'.length);
  expect(targetRange.getLocation(targetRange.pos)).toEqual({ line: 2, column: 13 });

  // The link text range is reported separately from the target range
  const linkTextRange: TextRange = expectTextRangeSlice(linkTag.linkTextTextRange, buffer, 'the button');
  expect(linkTextRange.pos).toEqual(buffer.indexOf('the button'));
  expect(targetRange.end).toBeLessThan(linkTextRange.pos);
});

test('01 Inline link with link text: URL destination ranges', () => {
  const buffer: string = ['/**', ' * {@link https://example.com/path?q=1 | example site}', ' */'].join('\n');
  const parserContext: ParserContext = parseText(buffer);
  expect(parserContext.log.messages).toEqual([]);

  const linkTags: DocNode[] = findNodesOfKind(parserContext.docComment, DocNodeKind.LinkTag);
  expect(linkTags).toHaveLength(1);
  const linkTag: DocLinkTag = linkTags[0] as DocLinkTag;

  expect(linkTag.urlDestination).toEqual('https://example.com/path?q=1');

  const targetRange: TextRange = expectTextRangeSlice(
    linkTag.linkTargetTextRange,
    buffer,
    'https://example.com/path?q=1'
  );
  expect(targetRange.pos).toEqual(buffer.indexOf('https://example.com/path?q=1'));

  expectTextRangeSlice(linkTag.linkTextTextRange, buffer, 'example site');
});

test('02 Multi-line comment: stripped line prefixes still map to the original comment', () => {
  const buffer: string = [
    '/**',
    ' * 1{@link my-package#',
    ' * (Button:class) | link',
    ' * text }2',
    ' */'
  ].join('\n');
  const parserContext: ParserContext = parseText(buffer);
  expect(parserContext.log.messages).toEqual([]);

  const linkTags: DocNode[] = findNodesOfKind(parserContext.docComment, DocNodeKind.LinkTag);
  expect(linkTags).toHaveLength(1);
  const linkTag: DocLinkTag = linkTags[0] as DocLinkTag;

  expect(linkTag.codeDestination).toBeDefined();
  expect(linkTag.linkText).toEqual('link\ntext');

  // The destination spans two comment lines; the containing range includes the
  // newline and the stripped " * " line prefix, and indexes into the original comment
  const expectedTargetSlice: string = 'my-package#\n * (Button:class)';
  const targetRange: TextRange = expectTextRangeSlice(
    linkTag.linkTargetTextRange,
    buffer,
    expectedTargetSlice
  );
  expect(targetRange.pos).toEqual(buffer.indexOf('my-package'));
  expect(targetRange.end).toEqual(buffer.indexOf('(Button:class)') + '(Button:class)'.length);
  expect(targetRange.getLocation(targetRange.pos)).toEqual({ line: 2, column: 12 });

  // The link text also spans two comment lines
  const expectedLinkTextSlice: string = 'link\n * text';
  const linkTextRange: TextRange = expectTextRangeSlice(
    linkTag.linkTextTextRange,
    buffer,
    expectedLinkTextSlice
  );
  expect(linkTextRange.pos).toEqual(buffer.indexOf('| link') + 2);
  expect(linkTextRange.end).toEqual(buffer.indexOf('text') + 'text'.length);
});

test('03 Bad link targets keep the original diagnostics without a fabricated target', () => {
  // Case 1: Empty link content
  const buffer1: string = ['/**', ' * {@link}', ' */'].join('\n');
  const parserContext1: ParserContext = parseText(buffer1);
  expect(parserContext1.log.messages.map((x) => x.messageId)).toEqual([TSDocMessageId.LinkTagEmpty]);
  expect(parserContext1.log.messages[0].text).toEqual('(2,5): The @link tag content is missing');
  // The original diagnostic points at the "@link" tag name in the original comment
  const diagnosticRange1: TextRange = parserContext1.log.messages[0].textRange;
  expect(buffer1.substring(diagnosticRange1.pos, diagnosticRange1.end)).toEqual('@link');
  // No DocLinkTag is produced, so no target range can be queried for the broken link
  expect(findNodesOfKind(parserContext1.docComment, DocNodeKind.LinkTag)).toEqual([]);
  expect(findNodesOfKind(parserContext1.docComment, DocNodeKind.InlineTag)).toHaveLength(1);

  // Case 2: Invalid URL destination
  const buffer2: string = ['/**', ' * {@link http://}', ' */'].join('\n');
  const parserContext2: ParserContext = parseText(buffer2);
  expect(parserContext2.log.messages.map((x) => x.messageId)).toEqual([TSDocMessageId.LinkTagInvalidUrl]);
  const message2: ParserMessage = parserContext2.log.messages[0];
  expect(message2.text).toEqual('(2,11): An @link URL must have at least one character after "://"');
  // The original diagnostic location is the URL excerpt in the original comment
  expect(buffer2.substring(message2.textRange.pos, message2.textRange.end)).toEqual('http://');
  expect(findNodesOfKind(parserContext2.docComment, DocNodeKind.LinkTag)).toEqual([]);
  expect(findNodesOfKind(parserContext2.docComment, DocNodeKind.InlineTag)).toHaveLength(1);

  // Case 3: Malformed declaration reference
  const buffer3: string = ['/**', ' * {@link #}', ' */'].join('\n');
  const parserContext3: ParserContext = parseText(buffer3);
  expect(parserContext3.log.messages.map((x) => x.messageId)).toEqual([TSDocMessageId.ReferenceHashSyntax]);
  const message3: ParserMessage = parserContext3.log.messages[0];
  expect(message3.text).toEqual(
    '(2,11): The hash character must be preceded by a package name or import path'
  );
  expect(buffer3.substring(message3.textRange.pos, message3.textRange.end)).toEqual('#');
  expect(findNodesOfKind(parserContext3.docComment, DocNodeKind.LinkTag)).toEqual([]);
  expect(findNodesOfKind(parserContext3.docComment, DocNodeKind.InlineTag)).toHaveLength(1);
});

test('04 Builder scenario: no ranges are fabricated without parsed excerpts', () => {
  const configuration: TSDocConfiguration = new TSDocConfiguration();

  const urlLinkTag: DocLinkTag = new DocLinkTag({
    configuration,
    tagName: '@link',
    urlDestination: 'http://example.com',
    linkText: 'example'
  });
  expect(urlLinkTag.urlDestination).toEqual('http://example.com');
  expect(urlLinkTag.linkTargetTextRange).toBeUndefined();
  expect(urlLinkTag.linkTextTextRange).toBeUndefined();

  // A DocInlineTag (which is what the parser produces for a broken link) has no
  // link target query at all
  const inlineTag: DocInlineTag = new DocInlineTag({
    configuration,
    tagName: '@link',
    tagContent: ''
  });
  expect(inlineTag instanceof DocLinkTag).toBe(false);
});
