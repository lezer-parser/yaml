import {ExternalTokenizer, ContextTracker} from "@lezer/lr"
import {
  DirectiveEnd, DocEnd,
  sequenceStartMark, sequenceContinueMark, blockEnd,
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
    if (ch == 10 || ch == 13 || ch == -1) return col
  }
}

function isSpace(ch) {
  return ch == 32 || ch == 9 || ch == 10 || ch == 13 || ch < 0
}

export const indentation = new ContextTracker({
  start: Context.top,
  reduce(context, term) {
    return context.type == type_Flow && (term == FlowSequence || term == FlowMapping) ? context.parent : context
  },
  shift(context, term, stack, input) {
    if (term == sequenceStartMark) return new Context(context, findColumn(input, input.pos), type_Seq)
    // FIXME mapStartMark
    if (term == blockEnd) return context.parent
    if (term == BracketL || term == BraceL) return new Context(context, 0, type_Flow)
    return context
  },
  hash(context) { return context.hash }
})

export const newlines = new ExternalTokenizer((input, stack) => {
  if (input.next == -1 && stack.canShift(blockEnd))
    return input.acceptToken(blockEnd)
  let prev = input.peek(-1)
  if ((prev == 10 /* '\n' */ || prev == 13 /* '\r' */ || prev < 0) && stack.context.type != type_Flow) {
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

export const sequence = new ExternalTokenizer((input, stack) => {
  if (input.next == 45 /* '-' */) {
    input.advance()
    if (input.next == 10 || input.next == 32 || input.next == 9)
      input.acceptToken(stack.context.type == type_Seq && stack.context.depth == findColumn(input, input.pos - 1)
                        ? sequenceContinueMark : sequenceStartMark)
  }
}, {contextual: true})
