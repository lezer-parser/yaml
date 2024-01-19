import {ExternalTokenizer, ContextTracker} from "@lezer/lr"
import {
  DirectiveEnd, DocEnd, blockEnd,
  sequenceStartMark, sequenceContinueMark,
  explicitMapStartMark, explicitMapContinueMark,
  mapStartMark, mapContinueMark, flowMapMark,
  Literal, QuotedLiteral, Anchor, Alias, Tag,
  BracketL, BraceL, FlowSequence, FlowMapping
} from "./parser.terms.js"

const type_Top = 0, type_Seq = 1, type_Map = 2, type_Flow = 3

class Context {
  constructor(parent, depth, type) {
    this.parent = parent
    this.depth = depth
    this.type = type
    this.hash = (parent ? parent.hash + parent.hash << 8 : 0) + depth + (depth << 4) + type
  }

  static top = new Context(null, 0, type_Top)
}

function findColumn(input, pos) {
  for (let col = 0, p = pos - input.pos - 1;; p--, col++) {
    let ch = input.peek(p)
    if (isBreakSpace(ch) || ch == -1) return col
  }
}

function isNonBreakSpace(ch) {
  return ch == 32 || ch == 9
}

function isBreakSpace(ch) {
  return ch == 10 || ch == 13
}

function isSpace(ch) {
  return isNonBreakSpace(ch) || isBreakSpace(ch)
}

export const indentation = new ContextTracker({
  start: Context.top,
  reduce(context, term) {
    return context.type == type_Flow && (term == FlowSequence || term == FlowMapping) ? context.parent : context
  },
  shift(context, term, stack, input) {
    if (term == sequenceStartMark)
      return new Context(context, findColumn(input, input.pos), type_Seq)
    if (term == mapStartMark || term == explicitMapStartMark)
      return new Context(context, findColumn(input, input.pos), type_Map)
    if (term == blockEnd)
      return context.parent
    if (term == BracketL || term == BraceL)
      return new Context(context, 0, type_Flow)
    return context
  },
  hash(context) { return context.hash }
})

export const newlines = new ExternalTokenizer((input, stack) => {
  if (input.next == -1 && stack.canShift(blockEnd))
    return input.acceptToken(blockEnd)
  let prev = input.peek(-1)
  if ((isBreakSpace(prev) || prev < 0) && stack.context.type != type_Flow) {
    if (input.next == 45 /* '-' */ && input.peek(1) == 45 && input.peek(2) == 45 && isSpace(input.peek(3)))
      return input.acceptToken(DirectiveEnd, 3)
    if (input.next == 46 /* '.' */ && input.peek(1) == 46 && input.peek(2) == 46 && isSpace(input.peek(3)))
      return input.acceptToken(DocEnd, 3)
    let depth = 0
    while (input.next == 32 /* ' ' */) { depth++; input.advance() }
    if (depth < stack.context.depth &&
        // Not blank
        input.next != -1 && input.next != 10 && input.next != 13 && input.next != 35 /* '#' */)
      input.acceptToken(blockEnd, -depth)
  }
}, {contextual: true})

export const blockMark = new ExternalTokenizer((input, stack) => {
  if (stack.context.type == type_Flow) {
    if (input.next == 63 /* '?' */) {
      input.advance()
      if (isSpace(input.next) || input.next < 0)
        input.acceptToken(flowMapMark)
    }
    return
  }
  if (input.next == 45 /* '-' */) {
    input.advance()
    if (isSpace(input.next))
      input.acceptToken(stack.context.type == type_Seq && stack.context.depth == findColumn(input, input.pos - 1)
                        ? sequenceContinueMark : sequenceStartMark)
  } else if (input.next == 63 /* '?' */) {
    input.advance()
    if (isSpace(input.next) || input.next < 0)
      input.acceptToken(stack.context.type == type_Map && stack.context.depth == findColumn(input, input.pos - 1)
                        ? explicitMapContinueMark : explicitMapStartMark)
  } else {
    let start = input.pos
    // Scan over a potential key to see if it is followed by a colon.
    for (;;) {
      if (isNonBreakSpace(input.next)) {
        input.advance()
      } else if (input.next == 33 /* '!' */) {
        readTag(input)
      } else if (input.next == 38 /* '&' */) {
        readAnchor(input)
      } else if (input.next == 42 /* '*' */) {
        readAnchor(input)
        break
      } else if (input.next == 39 /* "'" */ || input.next == 34 /* '"' */) {
        if (readQuoted(input, true)) break
        return
      } else if (readPlain(input, true, false, 0)) {
        break
      } else {
        return
      }
    }
    while (isNonBreakSpace(input.next)) input.advance()
    if (input.next == 58 /* ':' */) {
      let after = input.peek(1)
      if (isSpace(after) || after < 0)
        input.acceptTokenTo(stack.context.type == type_Map && stack.context.depth == findColumn(input, start)
                            ? mapContinueMark : mapStartMark, start)
    }
  }
}, {contextual: true})

function uriChar(ch) {
  return ch > 32 && ch < 127 && ch != 34 && ch != 37 && ch != 60 &&
    ch != 62 && ch != 92 && ch != 94 && ch != 96 && ch != 123 && ch != 124 && ch != 125
}

function hexChar(ch) {
  return ch >= 48 && ch <= 57 || ch >= 97 && ch <= 102 || ch >= 65 && ch <= 70
}

function readUriChar(input) {
  if (input.next == 37 /* '%' */) {
    input.advance()
    if (hexChar(input.next)) input.advance()
    if (hexChar(input.next)) input.advance()
    return true
  } else if (uriChar(input.next)) {
    input.advance()
    return true
  }
  return false
}

function readTag(input) {
  input.advance() // !
  if (input.next == 60 /* '<' */) {
    input.advance()
    for (;;) {
      if (!readUriChar(input)) {
        if (input.next == 62 /* '>' */) input.advance()
        break
      }
    }
  } else {
    while (readUriChar(input)) {}
  }
}

function readAnchor(input) {
  input.advance()
  while (!isSpace(input.next) && safeCharTag(input.tag) != "f") input.advance()
}
  
function readQuoted(input, scan) {
  let quote = input.next, lineBreak = false, start = input.pos
  input.advance()
  for (;;) {
    let ch = input.next
    if (ch < 0) break
    input.advance()
    if (ch == quote) {
      if (ch == 39 /* "'" */) {
        if (input.next == 39) input.advance()
        else break
      } else {
        break
      }
    } else if (ch == 92 /* "\\" */ && quote == 34 /* '"' */) {
      if (input.next >= 0) input.advance()
    } else if (isBreakSpace(ch)) {
      if (scan) return false
      lineBreak = true
    } else if (scan && input.pos >= start + 1024) {
      return false
    }
  }
  return !lineBreak
}

// "Safe char" info for char codes 36 to 125. s: safe, u: unsafe, f: unsafe, disallowed in flow
const safeTable = "suuussusfussssssssssssusssuuussssssssssssssssssssssssssfsfssussssssssssssssssssssssssssfuf"

function safeCharTag(ch) {
  if (ch < 36) return "u"
  if (ch > 125) return "s"
  return safeTable[ch - 36]
}

function isSafe(ch, excludeFlow) {
  let tag = safeCharTag(ch)
  return excludeFlow ? tag == "s" : tag != "u"
}

function readPlain(input, scan, inFlow, indent) {
  if (isSafe(input.next, true) ||
      (input.next == 63 /* '?' */ || input.next == 58 /* ':' */ || input.next == 45 /* '-' */) &&
      isSafe(input.peek(1), inFlow)) {
    input.advance()
  } else {
    return false
  }
  let start = input.pos
  for (;;) {
    let next = input.next, off = 0, lineIndent = indent + 1
    while (isSpace(next)) {
      if (isBreakSpace(next)) {
        if (scan) return false
        lineIndent = 0
      } else {
        lineIndent++
      }
      next = input.peek(++off)
    }
    let safe = next >= 0 &&
        (next == 58 /* ':' */ ? input.peek(off + 1) != 32 /* ' ' */ :
         next == 32 /* ' ' */ ? input.peek(off + 1) != 35 /* '#' */ :
         isSafe(next, inFlow))
    if (!safe || !inFlow && lineIndent <= indent) break
    if (scan && safeCharTag(next) == "f") return false
    for (let i = off; i >= 0; i--) input.advance()
    if (scan && input.pos > start + 1024) return false
  }
  return true
}

export const literals = new ExternalTokenizer((input, stack) => {
  if (input.next == 33 /* '!' */) {
    readTag(input)
    input.acceptToken(Tag)
  } else if (input.next == 38 /* '&' */ || input.next == 42 /* '*' */) {
    let token = input.next == 38 ? Anchor : Alias
    readAnchor(input)
    input.acceptToken(token)
  } else if (input.next == 39 /* "'" */ || input.next == 34 /* '"' */) {
    readQuoted(input, false)
    input.acceptToken(QuotedLiteral)
  } else if (readPlain(input, false, stack.context.type == type_Flow, stack.context.depth)) {
    input.acceptToken(Literal)
  }
})
