// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { StringChecks } from '../parser/StringChecks';
import { Standardization } from '../details/Standardization';

/**
 * Determines the type of syntax for a TSDocTagDefinition
 */
export enum TSDocTagSyntaxKind {
  /**
   * The tag is intended to be an inline tag.  For example: `{@link}`.
   */
  InlineTag,

  /**
   * The tag is intended to be a block tag that starts a new documentation
   * section.  For example: `@remarks`
   */
  BlockTag,

  /**
   * The tag is intended to be a modifier tag whose presence indicates
   * an aspect of the associated API item.  For example: `@internal`
   */
  ModifierTag
}

/**
 * Constructor parameters for {@link TSDocTagDefinition}
 */
export interface ITSDocTagDefinitionParameters {
  tagName: string;
  syntaxKind: TSDocTagSyntaxKind;
  allowMultiple?: boolean;

  /**
   * The name of the canonical tag that this tag is an alias for, including the `@` prefix.
   *
   * @remarks
   * An alias shares its identity with the canonical tag for contract checking purposes
   * (for example, two aliases of the same tag cannot both appear in a doc comment),
   * but the original spelling of the alias is preserved in the parsed tree and in
   * diagnostic messages.  If omitted, the tag is its own canonical tag.
   *
   * Example: `@experimental` is an alias of `@beta`, so `aliasOf` would be `"@beta"`.
   */
  aliasOf?: string;
}

/**
 * @internal
 */
export interface ITSDocTagDefinitionInternalParameters extends ITSDocTagDefinitionParameters {
  standardization: Standardization;
}

/**
 * Defines a TSDoc tag that will be understood by the TSDocParser.
 */
export class TSDocTagDefinition {
  /**
   * The TSDoc tag name.  TSDoc tag names start with an at-sign (`@`) followed
   * by ASCII letters using "camelCase" capitalization.
   */
  public readonly tagName: string;

  /**
   * The TSDoc tag name in all capitals, which is used for performing
   * case-insensitive comparisons or lookups.
   */
  public readonly tagNameWithUpperCase: string;

  /**
   * Specifies the expected syntax for this tag.
   */
  public readonly syntaxKind: TSDocTagSyntaxKind;

  /**
   * Indicates the level of support expected from documentation tools that implement
   * the standard.
   */
  public readonly standardization: Standardization;

  /**
   * If true, then this TSDoc tag may appear multiple times in a doc comment.
   * By default, a tag may only appear once.
   */
  public readonly allowMultiple: boolean;

  /**
   * The canonical tag name in all capitals, which is used for performing
   * case-insensitive comparisons or lookups that unify aliases.
   *
   * @remarks
   * For most tags this is the same as {@link TSDocTagDefinition.tagNameWithUpperCase}.
   * For an alias, this is the canonical tag's name, so that an alias and its canonical
   * tag are treated as the same tag for contract checking while still preserving the
   * alias's original {@link TSDocTagDefinition.tagName}.
   */
  public readonly canonicalTagName: string;

  public constructor(parameters: ITSDocTagDefinitionParameters) {
    StringChecks.validateTSDocTagName(parameters.tagName);
    this.tagName = parameters.tagName;
    this.tagNameWithUpperCase = parameters.tagName.toUpperCase();
    this.syntaxKind = parameters.syntaxKind;
    this.standardization =
      (parameters as ITSDocTagDefinitionInternalParameters).standardization || Standardization.None;
    this.allowMultiple = !!parameters.allowMultiple;

    if (parameters.aliasOf !== undefined) {
      StringChecks.validateTSDocTagName(parameters.aliasOf);
      this.canonicalTagName = parameters.aliasOf.toUpperCase();
    } else {
      this.canonicalTagName = this.tagNameWithUpperCase;
    }
  }

  /**
   * Returns true if this tag is an alias of another (canonical) tag.
   */
  public get isAlias(): boolean {
    return this.canonicalTagName !== this.tagNameWithUpperCase;
  }

  /**
   * Throws an exception if `tagName` is not a valid TSDoc tag name.
   */
  public static validateTSDocTagName(tagName: string): void {
    StringChecks.validateTSDocTagName(tagName);
  }
}
