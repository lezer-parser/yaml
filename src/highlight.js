import {styleTags, tags as t} from "@lezer/highlight"

export const yamlHighlighting = styleTags({
  DirectiveName: t.keyword,
  DirectiveContent: t.attributeValue,
  "DirectiveEnd DocEnd": t.meta,
  QuotedLiteral: t.string,
  BlockLiteralHeader: t.special(t.string),
  BlockLiteralContent: t.content,
  Literal: t.content,
  QuotedLiteral: t.content,
  "Anchor Alias": t.tagName,
  Tag: t.typeName,
  Comment: t.lineComment,
  ": , -": t.separator,
  "?": t.punctuation,
  "[ ]": t.squareBracket,
  "{ }": t.brace
})
