// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { TSDocParser } from '../TSDocParser';
import type { ParserContext } from '../ParserContext';
import type { TextRange } from '../TextRange';
import { TSDocMessageId } from '../TSDocMessageId';
import { TSDocConfiguration } from '../../configuration/TSDocConfiguration';
import { DocInlineTag, DocLinkTag, type DocNode } from '../../nodes';

function parseBuffer(buffer: string): ParserContext {
  const configuration: TSDocConfiguration = new TSDocConfiguration();
  const tsdocParser: TSDocParser = new TSDocParser(configuration);
  return tsdocParser.parseString(buffer);
}

function collectNodes(docNode: DocNode, results: DocNode[] = []): DocNode[] {
  results.push(docNode);
  for (const childNode of docNode.getChildNodes()) {
    collectNodes(childNode, results);
  }
  return results;
}

function findLinkTags(parserContext: ParserContext): DocLinkTag[] {
  return collectNodes(parserContext.docComment).filter((x) => x instanceof DocLinkTag) as DocLinkTag[];
}

test('00 URL destination with link text: destination and link text ranges', () => {
  const buffer: string = ['/**', ' * {@link https://example.com/path | Example Text}', ' */'].join('\n');
  const parserContext: ParserContext = parseBuffer(buffer);

  expect(parserContext.log.messages).toEqual([]);

  const linkTags: DocLinkTag[] = findLinkTags(parserContext);
  expect(linkTags).toHaveLength(1);
  const linkTag: DocLinkTag = linkTags[0];

  expect(linkTag.urlDestination).toEqual('https://example.com/path');
  expect(linkTag.codeDestination).toBeUndefined();
  expect(linkTag.linkText).toEqual('Example Text');

  // The destination range maps back into the original comment buffer
  const destinationRange: TextRange = linkTag.destinationTextRange!;
  expect(destinationRange).toBeDefined();
  expect(destinationRange.buffer).toBe(buffer);
  expect(destinationRange.toString()).toEqual('https://example.com/path');
  expect(destinationRange.pos).toEqual(buffer.indexOf('https://example.com/path'));
  expect(destinationRange.end).toEqual(
    buffer.indexOf('https://example.com/path') + 'https://example.com/path'.length
  );
  expect(buffer.substring(destinationRange.pos, destinationRange.end)).toEqual('https://example.com/path');
  expect(destinationRange.getLocation(destinationRange.pos)).toEqual({ line: 2, column: 11 });

  // The link text range is reported separately from the destination range
  const linkTextRange: TextRange = linkTag.linkTextTextRange!;
  expect(linkTextRange).toBeDefined();
  expect(linkTextRange.buffer).toBe(buffer);
  expect(linkTextRange.toString()).toEqual('Example Text');
  expect(linkTextRange.pos).toEqual(buffer.indexOf('Example Text'));
  expect(linkTextRange.end).toEqual(buffer.indexOf('Example Text') + 'Example Text'.length);
  expect(linkTextRange.getLocation(linkTextRange.pos)).toEqual({ line: 2, column: 38 });

  // The two ranges do not overlap
  expect(linkTextRange.pos).toBeGreaterThan(destinationRange.end);
});

test('01 Multi-line declaration reference: range spans stripped comment lines', () => {
  const buffer: string = [
    '/**',
    ' * {@link MyClass.(',
    ' *   myMethod:instance) |',
    ' *   the method}',
    ' */'
  ].join('\n');
  const parserContext: ParserContext = parseBuffer(buffer);

  expect(parserContext.log.messages).toEqual([]);

  const linkTags: DocLinkTag[] = findLinkTags(parserContext);
  expect(linkTags).toHaveLength(1);
  const linkTag: DocLinkTag = linkTags[0];

  expect(linkTag.codeDestination).toBeDefined();
  expect(linkTag.urlDestination).toBeUndefined();
  expect(linkTag.linkText).toEqual('the method');

  // The destination range spans multiple comment lines; the newline and leading " * "
  // prefixes that were stripped by the LineExtractor still map back into the original comment
  const destinationRange: TextRange = linkTag.destinationTextRange!;
  expect(destinationRange).toBeDefined();
  expect(destinationRange.buffer).toBe(buffer);
  expect(destinationRange.toString()).toEqual('MyClass.(\n *   myMethod:instance)');
  expect(destinationRange.pos).toEqual(buffer.indexOf('MyClass'));
  expect(destinationRange.end).toEqual(buffer.indexOf('myMethod:instance)') + 'myMethod:instance)'.length);
  expect(destinationRange.getLocation(destinationRange.pos)).toEqual({ line: 2, column: 11 });
  expect(destinationRange.getLocation(destinationRange.end)).toEqual({ line: 3, column: 24 });

  const linkTextRange: TextRange = linkTag.linkTextTextRange!;
  expect(linkTextRange).toBeDefined();
  expect(linkTextRange.toString()).toEqual('the method');
  expect(linkTextRange.pos).toEqual(buffer.indexOf('the method'));
  expect(linkTextRange.getLocation(linkTextRange.pos)).toEqual({ line: 4, column: 6 });
});

test('02 Bad link targets: original diagnostics are preserved, no fabricated target', () => {
  const buffer: string = ['/**', ' * {@link http://}', ' * {@link #}', ' */'].join('\n');
  const parserContext: ParserContext = parseBuffer(buffer);

  // The malformed links produce generic DocInlineTag nodes, not DocLinkTag nodes,
  // so no destination range can be reported for them
  expect(findLinkTags(parserContext)).toHaveLength(0);
  const inlineTags: DocInlineTag[] = collectNodes(parserContext.docComment).filter(
    (x) => x instanceof DocInlineTag
  ) as DocInlineTag[];
  expect(inlineTags).toHaveLength(2);

  // The original diagnostics are preserved, with locations in the original comment
  expect(parserContext.log.messages).toHaveLength(2);

  const urlMessage = parserContext.log.messages[0];
  expect(urlMessage.messageId).toEqual(TSDocMessageId.LinkTagInvalidUrl);
  expect(urlMessage.unformattedText).toEqual('An @link URL must have at least one character after "://"');
  expect(urlMessage.textRange.buffer).toBe(buffer);
  expect(urlMessage.textRange.toString()).toEqual('http://');
  expect(urlMessage.textRange.pos).toEqual(buffer.indexOf('http://'));
  expect(urlMessage.textRange.getLocation(urlMessage.textRange.pos)).toEqual({
    line: 2,
    column: 11
  });

  const hashMessage = parserContext.log.messages[1];
  expect(hashMessage.messageId).toEqual(TSDocMessageId.ReferenceHashSyntax);
  expect(hashMessage.unformattedText).toEqual(
    'The hash character must be preceded by a package name or import path'
  );
  expect(hashMessage.textRange.buffer).toBe(buffer);
  expect(hashMessage.textRange.toString()).toEqual('#');
  expect(hashMessage.textRange.pos).toEqual(buffer.indexOf('#'));
  expect(hashMessage.textRange.getLocation(hashMessage.textRange.pos)).toEqual({
    line: 3,
    column: 11
  });
});

test('03 Builder scenario: no ranges are fabricated for a constructed DocLinkTag', () => {
  const configuration: TSDocConfiguration = new TSDocConfiguration();
  const linkTag: DocLinkTag = new DocLinkTag({
    configuration,
    tagName: '@link',
    urlDestination: 'https://example.com',
    linkText: 'Example Text'
  });

  expect(linkTag.urlDestination).toEqual('https://example.com');
  expect(linkTag.linkText).toEqual('Example Text');
  expect(linkTag.destinationTextRange).toBeUndefined();
  expect(linkTag.linkTextTextRange).toBeUndefined();
});
