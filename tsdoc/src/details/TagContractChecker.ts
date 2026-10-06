// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import type { TSDocConfiguration } from '../configuration/TSDocConfiguration';
import { type TSDocTagDefinition, TSDocTagSyntaxKind } from '../configuration/TSDocTagDefinition';
import type { DocNode } from '../nodes/DocNode';
import type { DocComment } from '../nodes/DocComment';
import { DocBlockTag } from '../nodes/DocBlockTag';
import { DocInlineTagBase } from '../nodes/DocInlineTagBase';
import { DocCodeSpan } from '../nodes/DocCodeSpan';
import { DocFencedCode } from '../nodes/DocFencedCode';
import { DocExcerpt, ExcerptKind } from '../nodes/DocExcerpt';
import { TextRange } from '../parser/TextRange';

/**
 * Unique identifiers for the diagnostics reported by {@link TagContractChecker}.
 *
 * @remarks
 * These identifiers are intentionally separate from the `TSDocMessageId` messages that the
 * parser itself reports:  the tag contract check is an explicit, opt-in phase that runs after
 * parsing and does not change the default parser behavior.
 *
 * @public
 */
export enum TagContractDiagnosticId {
  /**
   * A tag whose definition is `TSDocTagSyntaxKind.InlineTag` appeared in a block tag position
   * (at the start of a line, without `{ }` braces).
   */
  InlineTagInBlockPosition = 'tsdoc-contract-inline-tag-in-block-position',

  /**
   * A tag whose definition is `TSDocTagSyntaxKind.BlockTag` appeared inside `{ }` braces,
   * which is the inline tag position.
   */
  BlockTagInInlinePosition = 'tsdoc-contract-block-tag-in-inline-position',

  /**
   * A tag whose definition is `TSDocTagSyntaxKind.ModifierTag` appeared inside `{ }` braces,
   * which is the inline tag position.
   */
  ModifierTagInInlinePosition = 'tsdoc-contract-modifier-tag-in-inline-position',

  /**
   * A modifier tag appeared before a block tag in the doc comment.  Modifier tags must
   * appear after the block tags.
   */
  ModifierTagBeforeBlockTag = 'tsdoc-contract-modifier-tag-before-block-tag',

  /**
   * A tag whose definition does not allow multiple occurrences (`allowMultiple: false`)
   * appeared more than once in the doc comment.  Occurrences are matched using the canonical
   * tag name, so aliases of the same tag count as duplicates of each other.  A separate
   * diagnostic is reported for every occurrence.
   */
  DuplicateUniqueTag = 'tsdoc-contract-duplicate-unique-tag',

  /**
   * A tag is not defined in the `TSDocConfiguration`.  Unknown tags are reported with this
   * identifier, separately from duplicate unique tags.
   */
  UnknownTag = 'tsdoc-contract-unknown-tag'
}

/**
 * A single diagnostic reported by {@link TagContractChecker.check}.
 *
 * @public
 */
export interface ITagContractDiagnostic {
  /**
   * A string that uniquely identifies the kind of contract violation.
   */
  readonly messageId: TagContractDiagnosticId;

  /**
   * A description of the contract violation.
   */
  readonly messageText: string;

  /**
   * The range of the tag name in the original comment buffer.  The range is preserved
   * exactly as it appeared in the parsed input; it is not normalized or re-indented.
   * For doc nodes that were constructed programmatically (rather than parsed), this is
   * `TextRange.empty`.
   */
  readonly textRange: TextRange;

  /**
   * The tag name exactly as it was written in the doc comment, for example `@default`.
   */
  readonly tagName: string;

  /**
   * The canonical tag name of the matched `TSDocTagDefinition`, for example `@defaultValue`,
   * or `undefined` if the tag is not defined in the configuration.  When the tag was written
   * using an alias, this is the canonical name that the alias resolves to.
   */
  readonly canonicalTagName: string | undefined;
}

/**
 * Where a tag occurrence appeared in the doc comment.
 */
type TagOccurrencePosition = 'block' | 'inline';

interface ITagOccurrence {
  tagName: string;
  definition: TSDocTagDefinition | undefined;
  position: TagOccurrencePosition;
  textRange: TextRange;
}

/**
 * Performs an explicit contract check of the tags in a parsed doc comment against the
 * tag definitions in a {@link TSDocConfiguration}.
 *
 * @remarks
 * The checker enforces the contract implied by each `TSDocTagDefinition`:
 *
 * - The `syntaxKind` constrains where a tag may appear:  inline tags must use the `{ }` brace
 *   notation, block tags start a new documentation section, and modifier tags must appear
 *   at the block level after the other block tags.
 * - Tag {@link TSDocTagDefinition.aliases} share the identity of the canonical tag name,
 *   while diagnostics preserve the original spelling that was written in the comment.
 * - A tag with `allowMultiple: false` may only appear once; every duplicate occurrence is
 *   reported.  Unknown tags are reported separately from duplicate unique tags.
 *
 * The checker is a pure analysis pass over the parsed `DocComment` tree:
 *
 * - Content inside code spans and fenced code blocks never participates; an `@` sequence
 *   inside code is not a tag.
 * - Custom tag handlers (for example `DocNode` subclasses registered via
 *   `TSDocConfiguration.docNodeManager`) are never invoked during the contract check.
 * - Diagnostics preserve the text ranges of the original comment.
 *
 * The check is opt-in:  the `TSDocParser` itself is unchanged and does not report these
 * diagnostics unless the application explicitly invokes `TagContractChecker`.
 *
 * @public
 */
export class TagContractChecker {
  private readonly _configuration: TSDocConfiguration;

  public constructor(configuration: TSDocConfiguration) {
    this._configuration = configuration;
  }

  /**
   * Checks the tags of a parsed doc comment against the tag configuration contract,
   * and returns the diagnostics in the order that the offending tags appear in the
   * original comment.
   */
  public check(docComment: DocComment): ITagContractDiagnostic[] {
    const occurrences: ITagOccurrence[] = [];
    this._collectOccurrences(docComment, occurrences);

    const diagnostics: ITagContractDiagnostic[] = [];

    // Check each occurrence against the position contract for its syntax kind.
    for (const occurrence of occurrences) {
      const definition: TSDocTagDefinition | undefined = occurrence.definition;
      if (definition === undefined) {
        // Unknown tags are a separate category from duplicate unique tags.
        diagnostics.push(
          this._createDiagnostic(
            TagContractDiagnosticId.UnknownTag,
            `The TSDoc tag "${occurrence.tagName}" is not defined in this configuration`,
            occurrence
          )
        );
        continue;
      }

      switch (definition.syntaxKind) {
        case TSDocTagSyntaxKind.InlineTag:
          if (occurrence.position === 'block') {
            diagnostics.push(
              this._createDiagnostic(
                TagContractDiagnosticId.InlineTagInBlockPosition,
                `The TSDoc tag "${occurrence.tagName}" is an inline tag, but it appears in` +
                  ' a block tag position; it must be enclosed in "{ }" braces',
                occurrence
              )
            );
          }
          break;
        case TSDocTagSyntaxKind.BlockTag:
          if (occurrence.position === 'inline') {
            diagnostics.push(
              this._createDiagnostic(
                TagContractDiagnosticId.BlockTagInInlinePosition,
                `The TSDoc tag "${occurrence.tagName}" is a block tag, but it appears in` +
                  ' an inline tag position; it must not be enclosed in "{ }" braces',
                occurrence
              )
            );
          }
          break;
        case TSDocTagSyntaxKind.ModifierTag:
          if (occurrence.position === 'inline') {
            diagnostics.push(
              this._createDiagnostic(
                TagContractDiagnosticId.ModifierTagInInlinePosition,
                `The TSDoc tag "${occurrence.tagName}" is a modifier tag, but it appears in` +
                  ' an inline tag position; it must not be enclosed in "{ }" braces',
                occurrence
              )
            );
          }
          break;
      }
    }

    // Modifier tags must appear after the block tags in the doc comment.
    let lastBlockTagPos: number = -1;
    for (const occurrence of occurrences) {
      if (
        occurrence.position === 'block' &&
        occurrence.definition !== undefined &&
        occurrence.definition.syntaxKind === TSDocTagSyntaxKind.BlockTag &&
        !occurrence.textRange.isEmpty()
      ) {
        lastBlockTagPos = Math.max(lastBlockTagPos, occurrence.textRange.pos);
      }
    }
    if (lastBlockTagPos >= 0) {
      for (const occurrence of occurrences) {
        if (
          occurrence.position === 'block' &&
          occurrence.definition !== undefined &&
          occurrence.definition.syntaxKind === TSDocTagSyntaxKind.ModifierTag &&
          !occurrence.textRange.isEmpty() &&
          occurrence.textRange.pos < lastBlockTagPos
        ) {
          diagnostics.push(
            this._createDiagnostic(
              TagContractDiagnosticId.ModifierTagBeforeBlockTag,
              `The TSDoc modifier tag "${occurrence.tagName}" must appear after` +
                ' the block tags in a doc comment',
              occurrence
            )
          );
        }
      }
    }

    // Check for duplicate occurrences of unique tags.  Occurrences are grouped by the
    // canonical tag definition, so aliases of the same tag count as duplicates of each
    // other.  Every occurrence is reported.
    const occurrencesByDefinition: Map<TSDocTagDefinition, ITagOccurrence[]> = new Map();
    for (const occurrence of occurrences) {
      if (occurrence.definition === undefined) {
        continue;
      }
      let group: ITagOccurrence[] | undefined = occurrencesByDefinition.get(occurrence.definition);
      if (group === undefined) {
        group = [];
        occurrencesByDefinition.set(occurrence.definition, group);
      }
      group.push(occurrence);
    }
    for (const [definition, group] of occurrencesByDefinition) {
      if (definition.allowMultiple || group.length <= 1) {
        continue;
      }
      for (const occurrence of group) {
        let messageText: string =
          `The TSDoc tag "${occurrence.tagName}" can only appear once in a doc comment,` +
          ` but the tag "${definition.tagName}" appears ${group.length} times`;
        if (occurrence.tagName.toUpperCase() !== definition.tagNameWithUpperCase) {
          messageText += `; "${occurrence.tagName}" is an alias of "${definition.tagName}"`;
        }
        diagnostics.push(
          this._createDiagnostic(TagContractDiagnosticId.DuplicateUniqueTag, messageText, occurrence)
        );
      }
    }

    // Report the diagnostics in the order that the offending tags appear in the
    // original comment.
    diagnostics.sort((x, y) => {
      if (x.textRange.pos !== y.textRange.pos) {
        return x.textRange.pos - y.textRange.pos;
      }
      if (x.textRange.end !== y.textRange.end) {
        return x.textRange.end - y.textRange.end;
      }
      return x.messageId < y.messageId ? -1 : x.messageId > y.messageId ? 1 : 0;
    });

    return diagnostics;
  }

  private _createDiagnostic(
    messageId: TagContractDiagnosticId,
    messageText: string,
    occurrence: ITagOccurrence
  ): ITagContractDiagnostic {
    return {
      messageId,
      messageText,
      textRange: occurrence.textRange,
      tagName: occurrence.tagName,
      canonicalTagName: occurrence.definition === undefined ? undefined : occurrence.definition.tagName
    };
  }

  /**
   * Walks the doc node tree and collects every tag occurrence.  Code spans and fenced
   * code blocks are opaque:  their content is code, so any `@` sequences inside them
   * do not participate in the tag contract.  This is a pure inspection of the parsed
   * tree; no custom tag handlers are invoked.
   */
  private _collectOccurrences(docNode: DocNode, occurrences: ITagOccurrence[]): void {
    if (docNode instanceof DocCodeSpan || docNode instanceof DocFencedCode) {
      return;
    }

    if (docNode instanceof DocBlockTag) {
      occurrences.push({
        tagName: docNode.tagName,
        definition: this._configuration.tryGetTagDefinition(docNode.tagName),
        position: 'block',
        textRange: TagContractChecker._getBlockTagTextRange(docNode)
      });
      return;
    }

    if (docNode instanceof DocInlineTagBase) {
      occurrences.push({
        tagName: docNode.tagName,
        definition: this._configuration.tryGetTagDefinition(docNode.tagName),
        position: 'inline',
        textRange: TagContractChecker._getInlineTagTextRange(docNode)
      });
      // Continue walking:  an inline tag's content may contain nested nodes.
    }

    for (const childNode of docNode.getChildNodes()) {
      this._collectOccurrences(childNode, occurrences);
    }
  }

  private static _getBlockTagTextRange(docBlockTag: DocBlockTag): TextRange {
    try {
      return docBlockTag.getTokenSequence().getContainingTextRange();
    } catch {
      // The DocBlockTag was constructed programmatically rather than parsed, so it has
      // no excerpt preserving a range in the original comment.
      return TextRange.empty;
    }
  }

  private static _getInlineTagTextRange(docInlineTag: DocInlineTagBase): TextRange {
    for (const childNode of docInlineTag.getChildNodes()) {
      if (childNode instanceof DocExcerpt && childNode.excerptKind === ExcerptKind.InlineTag_TagName) {
        return childNode.content.getContainingTextRange();
      }
    }
    return TextRange.empty;
  }
}
