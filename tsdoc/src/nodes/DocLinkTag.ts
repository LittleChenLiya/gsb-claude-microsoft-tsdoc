// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { DocNodeKind, DocNode } from './DocNode';
import type { DocDeclarationReference } from './DocDeclarationReference';
import {
  DocInlineTagBase,
  type IDocInlineTagBaseParsedParameters,
  type IDocInlineTagBaseParameters
} from './DocInlineTagBase';
import { DocExcerpt, ExcerptKind } from './DocExcerpt';
import type { TextRange } from '../parser/TextRange';
import type { TokenSequence } from '../parser/TokenSequence';

/**
 * Constructor parameters for {@link DocLinkTag}.
 */
export interface IDocLinkTagParameters extends IDocInlineTagBaseParameters {
  codeDestination?: DocDeclarationReference;

  urlDestination?: string;

  linkText?: string;
}

/**
 * Constructor parameters for {@link DocLinkTag}.
 */
export interface IDocLinkTagParsedParameters extends IDocInlineTagBaseParsedParameters {
  codeDestination?: DocDeclarationReference;

  urlDestinationExcerpt?: TokenSequence;

  spacingAfterDestinationExcerpt?: TokenSequence;

  pipeExcerpt?: TokenSequence;
  spacingAfterPipeExcerpt?: TokenSequence;

  linkTextExcerpt?: TokenSequence;
  spacingAfterLinkTextExcerpt?: TokenSequence;
}

/**
 * Represents an `{@link}` tag.
 */
export class DocLinkTag extends DocInlineTagBase {
  private readonly _codeDestination: DocDeclarationReference | undefined;

  private _urlDestination: string | undefined;
  private readonly _urlDestinationExcerpt: DocExcerpt | undefined;

  private readonly _spacingAfterDestinationExcerpt: DocExcerpt | undefined;

  private readonly _pipeExcerpt: DocExcerpt | undefined;
  private readonly _spacingAfterPipeExcerpt: DocExcerpt | undefined;

  private _linkText: string | undefined;
  private readonly _spacingAfterLinkTextExcerpt: DocExcerpt | undefined;

  private readonly _linkTextExcerpt: DocExcerpt | undefined;

  /**
   * Don't call this directly.  Instead use {@link TSDocParser}
   * @internal
   */
  public constructor(parameters: IDocLinkTagParameters | IDocLinkTagParsedParameters) {
    super(parameters);

    if (this.tagNameWithUpperCase !== '@LINK') {
      throw new Error('DocLinkTag requires the tag name to be "{@link}"');
    }

    this._codeDestination = parameters.codeDestination;

    if (DocNode.isParsedParameters(parameters)) {
      if (parameters.codeDestination !== undefined && parameters.urlDestinationExcerpt !== undefined) {
        throw new Error('Either the codeDestination or the urlDestination may be specified, but not both');
      }

      if (parameters.urlDestinationExcerpt) {
        this._urlDestinationExcerpt = new DocExcerpt({
          configuration: this.configuration,
          excerptKind: ExcerptKind.LinkTag_UrlDestination,
          content: parameters.urlDestinationExcerpt
        });
      }
      if (parameters.spacingAfterDestinationExcerpt) {
        this._spacingAfterDestinationExcerpt = new DocExcerpt({
          configuration: this.configuration,
          excerptKind: ExcerptKind.Spacing,
          content: parameters.spacingAfterDestinationExcerpt
        });
      }

      if (parameters.pipeExcerpt) {
        this._pipeExcerpt = new DocExcerpt({
          configuration: this.configuration,
          excerptKind: ExcerptKind.LinkTag_Pipe,
          content: parameters.pipeExcerpt
        });
      }
      if (parameters.spacingAfterPipeExcerpt) {
        this._spacingAfterPipeExcerpt = new DocExcerpt({
          configuration: this.configuration,
          excerptKind: ExcerptKind.Spacing,
          content: parameters.spacingAfterPipeExcerpt
        });
      }

      if (parameters.linkTextExcerpt) {
        this._linkTextExcerpt = new DocExcerpt({
          configuration: this.configuration,
          excerptKind: ExcerptKind.LinkTag_LinkText,
          content: parameters.linkTextExcerpt
        });
      }
      if (parameters.spacingAfterLinkTextExcerpt) {
        this._spacingAfterLinkTextExcerpt = new DocExcerpt({
          configuration: this.configuration,
          excerptKind: ExcerptKind.Spacing,
          content: parameters.spacingAfterLinkTextExcerpt
        });
      }
    } else {
      if (parameters.codeDestination !== undefined && parameters.urlDestination !== undefined) {
        throw new Error('Either the codeDestination or the urlDestination may be specified, but not both');
      }

      this._urlDestination = parameters.urlDestination;
      this._linkText = parameters.linkText;
    }
  }

  /** @override */
  public get kind(): DocNodeKind | string {
    return DocNodeKind.LinkTag;
  }

  /**
   * If the link tag refers to a declaration, this returns the declaration reference object;
   * otherwise this property is undefined.
   * @remarks
   * Either the `codeDestination` or the `urlDestination` property will be defined, but never both.
   */
  public get codeDestination(): DocDeclarationReference | undefined {
    return this._codeDestination;
  }

  /**
   * If the link tag was an ordinary URI, this returns the URL string;
   * otherwise this property is undefined.
   * @remarks
   * Either the `codeDestination` or the `urlDestination` property will be defined, but never both.
   */
  public get urlDestination(): string | undefined {
    if (this._urlDestination === undefined) {
      if (this._urlDestinationExcerpt !== undefined) {
        this._urlDestination = this._urlDestinationExcerpt.content.toString();
      }
    }
    return this._urlDestination;
  }

  /**
   * An optional text string that is the hyperlink text.  If omitted, the documentation
   * renderer will use a default string based on the link itself (e.g. the URL text
   * or the declaration identifier).
   *
   * @remarks
   *
   * In HTML, the hyperlink can include leading/trailing space characters around the link text.
   * For example, this HTML will cause a web browser to `y` and also the space character before
   * and after it:
   *
   * ```html
   * x<a href="#Button"> y </a> z
   * ```
   *
   * Unlike HTML, TSDoc trims leading/trailing spaces.  For example, this TSDoc will be
   * displayed `xy z` and underline only the `y` character:
   *
   * ```
   * x{@link Button | y } z
   * ```
   */
  public get linkText(): string | undefined {
    if (this._linkText === undefined) {
      if (this._linkTextExcerpt !== undefined) {
        this._linkText = this._linkTextExcerpt.content.toString();
      }
    }
    return this._linkText;
  }

  /**
   * If the link tag was parsed from a doc comment, this returns the text range within the
   * original input corresponding to the link destination; otherwise this property is undefined.
   *
   * @remarks
   * The returned range refers to the original input buffer that was provided to the
   * {@link TSDocParser}, so it can be used to report errors or to highlight the link
   * destination in a source file.  For a multi-line declaration reference, the range
   * spans across the comment lines, including any newline characters and leading `*`
   * characters that appear between the tokens of the destination.
   *
   * This range covers the destination only; the {@link DocLinkTag.linkTextTextRange} property
   * returns the separate range for the link text.
   *
   * If the link tag could not be parsed successfully, the parser reports an error and produces
   * a generic {@link DocInlineTag} node instead of a `DocLinkTag`, so this property never
   * reports a destination range for a malformed link.
   */
  public get destinationTextRange(): TextRange | undefined {
    if (this._urlDestinationExcerpt !== undefined) {
      return this._urlDestinationExcerpt.content.getContainingTextRange();
    }
    if (this._codeDestination !== undefined) {
      return DocLinkTag._getTextRangeForNode(this._codeDestination);
    }
    return undefined;
  }

  /**
   * If the link tag was parsed from a doc comment and includes link text, this returns the
   * text range within the original input corresponding to the link text; otherwise this
   * property is undefined.
   *
   * @remarks
   * The returned range refers to the original input buffer that was provided to the
   * {@link TSDocParser}.  For link text that spans multiple comment lines, the range
   * spans across the comment lines, including any newline characters and leading `*`
   * characters that appear between the tokens of the link text.
   *
   * This range covers the link text only; the {@link DocLinkTag.destinationTextRange} property
   * returns the separate range for the link destination.
   */
  public get linkTextTextRange(): TextRange | undefined {
    if (this._linkTextExcerpt !== undefined) {
      return this._linkTextExcerpt.content.getContainingTextRange();
    }
    return undefined;
  }

  /** @override */
  protected getChildNodesForContent(): ReadonlyArray<DocNode | undefined> {
    // abstract
    return [
      this._codeDestination,
      this._urlDestinationExcerpt,
      this._spacingAfterDestinationExcerpt,
      this._pipeExcerpt,
      this._spacingAfterPipeExcerpt,
      this._linkTextExcerpt,
      this._spacingAfterLinkTextExcerpt
    ];
  }

  /**
   * Calculates the smallest TextRange that contains all the non-spacing DocExcerpt
   * content in the subtree rooted at the specified node.  Returns undefined if the
   * subtree contains no excerpts, for example if the node was constructed using
   * the builder scenario instead of being parsed from an input.
   */
  private static _getTextRangeForNode(docNode: DocNode): TextRange | undefined {
    let textRange: TextRange | undefined = undefined;

    const nodesToVisit: DocNode[] = [docNode];
    while (nodesToVisit.length > 0) {
      const currentNode: DocNode = nodesToVisit.pop()!;
      if (currentNode instanceof DocExcerpt) {
        if (currentNode.excerptKind !== ExcerptKind.Spacing) {
          const excerptRange: TextRange = currentNode.content.getContainingTextRange();
          if (!excerptRange.isEmpty()) {
            if (textRange === undefined) {
              textRange = excerptRange;
            } else {
              textRange = textRange.getNewRange(
                Math.min(textRange.pos, excerptRange.pos),
                Math.max(textRange.end, excerptRange.end)
              );
            }
          }
        }
      } else {
        nodesToVisit.push(...currentNode.getChildNodes());
      }
    }

    return textRange;
  }
}
