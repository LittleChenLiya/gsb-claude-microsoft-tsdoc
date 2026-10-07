// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import type { DocBlockTag } from '../nodes/DocBlockTag';
import { type TSDocTagDefinition, TSDocTagSyntaxKind } from '../configuration/TSDocTagDefinition';

/**
 * Represents a set of modifier tags that were extracted from a doc comment.
 *
 * @remarks
 * TSDoc modifier tags are block tags that do not have any associated rich text content.
 * Instead, their presence or absence acts as an on/off switch, indicating some aspect
 * of the underlying API item.  For example, the `@internal` modifier indicates that a
 * signature is internal (i.e. not part of the public API contract).
 */
export class ModifierTagSet {
  private readonly _nodes: DocBlockTag[] = [];

  // NOTE: To implement case insensitivity, the keys in this set are always upper-case.
  // This convention makes the normalization more obvious (and as a general practice handles
  // the Turkish "i" character correctly).
  private readonly _nodesByName: Map<string, DocBlockTag> = new Map<string, DocBlockTag>();

  // Every modifier tag node that was added, in the original order in which the tags
  // were encountered.  Unlike `_nodes`, this list also includes duplicate tags.
  private readonly _nodesInOrder: DocBlockTag[] = [];

  // The subset of `_nodesInOrder` whose tags were discarded as duplicates of an earlier
  // tag with the same name.  They are retained (separately from the deduplicated set)
  // so that diagnostics can report them.
  private readonly _duplicateNodes: DocBlockTag[] = [];

  /**
   * The original block tag nodes that defined the modifiers in this set, excluding duplicates.
   */
  public get nodes(): ReadonlyArray<DocBlockTag> {
    return this._nodes;
  }

  /**
   * All of the modifier tag nodes that were added to this set, in the original order
   * in which they were encountered, including any duplicates.
   *
   * @remarks
   * This is a read-only view of the modifier tags as they appeared in the doc comment;
   * it does not modify the `DocNode` tree.  Unlike {@link ModifierTagSet.nodes}, repeated
   * occurrences of the same tag are preserved here, so this list may be longer than
   * `nodes`.  Only tags that were recognized as modifiers (according to the
   * `TSDocConfiguration` tag definitions) are included; unrecognized tags are never
   * treated as modifiers.
   */
  public get nodesInOrder(): ReadonlyArray<DocBlockTag> {
    return this._nodesInOrder;
  }

  /**
   * The modifier tag nodes that were discarded because an earlier tag with the same
   * name was already present in the set.
   *
   * @remarks
   * These nodes are retained separately from the deduplicated set so that a tool can
   * report diagnostics (for example, a warning that `@internal` was specified twice).
   * Each item also appears in {@link ModifierTagSet.nodesInOrder}.
   */
  public get duplicateNodes(): ReadonlyArray<DocBlockTag> {
    return this._duplicateNodes;
  }

  /**
   * Returns true if the set contains a DocBlockTag with the specified tag name.
   * Note that synonyms are not considered.  The comparison is case-insensitive.
   * @param modifierTagName - The name of the tag, including the `@` prefix  For example, `@internal`
   */
  public hasTagName(modifierTagName: string): boolean {
    return this._nodesByName.has(modifierTagName.toUpperCase());
  }

  /**
   * Returns true if the set contains a DocBlockTag matching the specified tag definition.
   * Note that synonyms are not considered.  The comparison is case-insensitive.
   * The TSDocTagDefinition must be a modifier tag.
   * @param tagName - The name of the tag, including the `@` prefix  For example, `@internal`
   */
  public hasTag(modifierTagDefinition: TSDocTagDefinition): boolean {
    return !!this.tryGetTag(modifierTagDefinition);
  }

  /**
   * Returns a DocBlockTag matching the specified tag definition, or undefined if no such
   * tag was added to the set.  If there were multiple instances, returned object will be
   * the first one to be added.
   */
  public tryGetTag(modifierTagDefinition: TSDocTagDefinition): DocBlockTag | undefined {
    if (modifierTagDefinition.syntaxKind !== TSDocTagSyntaxKind.ModifierTag) {
      throw new Error('The tag definition is not a modifier tag');
    }
    return this._nodesByName.get(modifierTagDefinition.tagNameWithUpperCase);
  }

  /**
   * Adds a new modifier tag to the set.  If a tag already exists with the same name,
   * then the set is not changed, and the return value is false; however the duplicate
   * node is still recorded in {@link ModifierTagSet.nodesInOrder} and
   * {@link ModifierTagSet.duplicateNodes} so that the original tag order is preserved
   * and the duplicate can be reported by diagnostics.
   */
  public addTag(blockTag: DocBlockTag): boolean {
    this._nodesInOrder.push(blockTag);

    if (this._nodesByName.has(blockTag.tagNameWithUpperCase)) {
      this._duplicateNodes.push(blockTag);
      return false;
    }

    this._nodesByName.set(blockTag.tagNameWithUpperCase, blockTag);
    this._nodes.push(blockTag);

    return true;
  }
}
