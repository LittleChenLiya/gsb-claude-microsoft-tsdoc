// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import type { ParserContext } from './ParserContext';
import type { DocNode } from '../nodes/DocNode';
import { DocBlockTag } from '../nodes/DocBlockTag';
import { DocInlineTagBase } from '../nodes/DocInlineTagBase';
import type { TokenSequence } from './TokenSequence';
import {
  type TSDocTagDefinition,
  TSDocTagSyntaxKind
} from '../configuration/TSDocTagDefinition';
import { StandardTags } from '../details/StandardTags';
import { TSDocMessageId } from './TSDocMessageId';

/**
 * Represents a single TSDoc tag occurrence that was collected from a parsed doc comment.
 *
 * @remarks
 * The contract checker walks the parsed DocNode tree (rather than re-scanning the raw
 * input), so content inside code spans and fenced code blocks is never mistaken for tags.
 */
interface ITagOccurrence {
  tagDefinition: TSDocTagDefinition;
  tagName: string;
  node: DocBlockTag | DocInlineTagBase;
  isInline: boolean;
}

/**
 * Performs explicit contract checking for the TSDoc tag configuration.
 *
 * @remarks
 * The TSDocParser builds a DocNode tree from a doc comment.  The TagContractChecker
 * then walks that tree and validates the tag configuration against it:
 *
 * - Position: block tags, inline tags, and modifier tags are each constrained to the
 *   position that matches their TSDocTagSyntaxKind.
 * - Duplicates: a tag that does not set allowMultiple (and every modifier tag) may
 *   only appear once.  Aliases are unified by their canonical name, so an alias and its
 *   canonical tag cannot both appear.
 *
 * The checker is a pure inspection: it never invokes any tag-specific parsing or
 * transformation logic, and it never re-scans the raw input.  Diagnostics are reported at
 * the original tag token sequence, preserving the original comment range.
 */
export class TagContractChecker {
  private readonly _parserContext: ParserContext;

  public constructor(parserContext: ParserContext) {
    this._parserContext = parserContext;
  }

  public check(): void {
    const occurrences: ITagOccurrence[] = [];

    // Block tags are collected from the parsed block-tag collection, which retains every
    // occurrence (including duplicates).  This is important because specialized properties
    // such as remarksBlock only retain a single block.
    const collectedNodes: Set<DocNode> = new Set<DocNode>();
    for (const docBlock of this._parserContext.docComment.blockTags) {
      if (this._addBlockTagOccurrence(docBlock.blockTag, occurrences)) {
        collectedNodes.add(docBlock.blockTag);
      }
    }

    // Modifier tags are collected from the modifier set, which retains every occurrence.
    for (const docBlockTag of this._parserContext.docComment.modifierTagSet.nodes) {
      if (this._addBlockTagOccurrence(docBlockTag, occurrences)) {
        collectedNodes.add(docBlockTag);
      }
    }

    // Inline tags (and any block tags that were not wrapped in a DocBlock, for example an
    // inline tag mistakenly placed in block position) are collected by walking the parsed
    // DocNode tree.  Because this walks the tree (rather than re-scanning raw input),
    // content inside code spans and fenced code blocks is never mistaken for tags.
    this._collectTagsFromTree(this._parserContext.docComment, occurrences, collectedNodes);

    this._checkPosition(occurrences);
    this._checkDuplicates(occurrences);
  }

  /**
   * Adds a block-tag occurrence to the list, if the tag is defined in the configuration.
   *
   * @returns true if the occurrence was added; false if the tag is undefined.
   */
  private _addBlockTagOccurrence(
    docBlockTag: DocBlockTag,
    occurrences: ITagOccurrence[]
  ): boolean {
    const tagDefinition: TSDocTagDefinition | undefined =
      this._parserContext.configuration.tryGetTagDefinitionWithUpperCase(
        docBlockTag.tagNameWithUpperCase
      );
    if (tagDefinition) {
      occurrences.push({
        tagDefinition,
        tagName: docBlockTag.tagName,
        node: docBlockTag,
        isInline: false
      });
      return true;
    }
    return false;
  }

  /**
   * Recursively collects tag occurrences from the DocNode tree.
   *
   * @remarks
   * Block tags that were already collected from the parsed block-tag collection or the
   * modifier set are skipped to avoid double-counting.  This walk also catches block tags
   * that were not wrapped in a DocBlock (for example an inline tag mistakenly placed in
   * block position).
   */
  private _collectTagsFromTree(
    node: DocNode,
    occurrences: ITagOccurrence[],
    collectedNodes: Set<DocNode>
  ): void {
    if (!collectedNodes.has(node)) {
      if (node instanceof DocBlockTag) {
        const tagDefinition: TSDocTagDefinition | undefined =
          this._parserContext.configuration.tryGetTagDefinitionWithUpperCase(node.tagNameWithUpperCase);
        if (tagDefinition) {
          occurrences.push({
            tagDefinition,
            tagName: node.tagName,
            node,
            isInline: false
          });
        }
      } else if (node instanceof DocInlineTagBase) {
        const tagDefinition: TSDocTagDefinition | undefined =
          this._parserContext.configuration.tryGetTagDefinitionWithUpperCase(node.tagNameWithUpperCase);
        if (tagDefinition) {
          occurrences.push({
            tagDefinition,
            tagName: node.tagName,
            node,
            isInline: true
          });
        }
      }
    }

    for (const childNode of node.getChildNodes()) {
      this._collectTagsFromTree(childNode, occurrences, collectedNodes);
    }
  }

  private _checkPosition(occurrences: ITagOccurrence[]): void {
    for (const occurrence of occurrences) {
      const { tagDefinition, tagName, node, isInline } = occurrence;
      const syntaxKind: TSDocTagSyntaxKind = tagDefinition.syntaxKind;

      if (isInline) {
        if (syntaxKind === TSDocTagSyntaxKind.BlockTag || syntaxKind === TSDocTagSyntaxKind.ModifierTag) {
          const category: string =
            syntaxKind === TSDocTagSyntaxKind.BlockTag ? 'block' : 'modifier';
          this._parserContext.log.addMessageForTokenSequence(
            TSDocMessageId.TagShouldNotHaveBraces,
            `The TSDoc tag "${tagName}" is a ${category} tag; it must not be enclosed in "{ }" braces`,
            this._getTokenSequence(node),
            node
          );
        }
      } else {
        if (syntaxKind === TSDocTagSyntaxKind.InlineTag) {
          this._parserContext.log.addMessageForTokenSequence(
            TSDocMessageId.InlineTagMissingBraces,
            `The TSDoc tag "${tagName}" is an inline tag; it must be enclosed in "{ }" braces`,
            this._getTokenSequence(node),
            node
          );
        }
      }
    }
  }

  private _checkDuplicates(occurrences: ITagOccurrence[]): void {
    const groupsByCanonicalName: Map<string, ITagOccurrence[]> = new Map<
      string,
      ITagOccurrence[]
    >();
    for (const occurrence of occurrences) {
      const canonicalName: string = occurrence.tagDefinition.canonicalTagName;
      let group: ITagOccurrence[] | undefined = groupsByCanonicalName.get(canonicalName);
      if (group === undefined) {
        group = [];
        groupsByCanonicalName.set(canonicalName, group);
      }
      group.push(occurrence);
    }

    for (const group of groupsByCanonicalName.values()) {
      if (group.length <= 1) {
        continue;
      }

      const first: ITagOccurrence = group[0];

      if (
        first.tagDefinition.tagNameWithUpperCase ===
        StandardTags.inheritDoc.tagNameWithUpperCase
      ) {
        continue;
      }

      const isUnique: boolean =
        !first.tagDefinition.allowMultiple ||
        first.tagDefinition.syntaxKind === TSDocTagSyntaxKind.ModifierTag;

      if (!isUnique) {
        continue;
      }

      for (const occurrence of group) {
        this._parserContext.log.addMessageForTokenSequence(
          TSDocMessageId.DuplicateTag,
          `The TSDoc tag "${occurrence.tagName}" may only appear once in a doc comment`,
          this._getTokenSequence(occurrence.node),
          occurrence.node
        );
      }
    }
  }

  private _getTokenSequence(node: DocBlockTag | DocInlineTagBase): TokenSequence {
    return node.getTokenSequence();
  }
}
