// The expression language of widgets (plot curves, points, readouts). Lessons are shared in
// public, so this is a tiny parser that builds closures. It never calls `eval` or `Function`.
//
//   numbers  + - * / ^ (right-assoc)  unary -  ( )  ,
//   functions: sin cos tan asin acos atan sqrt abs exp ln log min max floor ceil round sign
//   constants: pi e        variables: any other identifier (x, param ids)

export type ExprFn = (vars: Readonly<Record<string, number>>) => number

export interface CompiledExpr {
  readonly fn: ExprFn
  // Variable names the expression reads, so a validator can check them against the params.
  readonly vars: ReadonlyArray<string>
}

export class ExprError extends Error {
  override readonly name = "ExprError"
  constructor(
    message: string,
    readonly at: number,
  ) {
    super(message)
  }
}

// Null-prototype tables, so a name like "constructor" can't resolve to an Object.prototype member.
const fns1: Record<string, (a: number) => number> = Object.assign(Object.create(null), {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sqrt: Math.sqrt,
  abs: Math.abs,
  exp: Math.exp,
  ln: Math.log,
  log: Math.log10,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  sign: Math.sign,
})
const fnsN: Record<string, (...a: Array<number>) => number> = Object.assign(Object.create(null), {
  min: Math.min,
  max: Math.max,
})
const consts: Record<string, number> = Object.assign(Object.create(null), { pi: Math.PI, e: Math.E })

type Tok =
  | { k: "num"; v: number; at: number }
  | { k: "id"; v: string; at: number }
  | { k: "op"; v: string; at: number }
  | { k: "end"; at: number }

function tokenize(src: string): Array<Tok> {
  const out: Array<Tok> = []
  let i = 0
  while (i < src.length) {
    const ch = src[i] as string
    if (ch === " " || ch === "\t") {
      i++
      continue
    }
    const num = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i))
    if (num) {
      out.push({ k: "num", v: Number(num[0]), at: i })
      i += num[0].length
      continue
    }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))
    if (id) {
      out.push({ k: "id", v: id[0], at: i })
      i += id[0].length
      continue
    }
    if ("+-*/^(),".includes(ch)) {
      out.push({ k: "op", v: ch, at: i })
      i++
      continue
    }
    throw new ExprError(`unexpected "${ch}"`, i)
  }
  out.push({ k: "end", at: src.length })
  return out
}

export function compileExpr(src: string): CompiledExpr {
  if (src.length > 300) throw new ExprError("expression is longer than 300 characters", 0)
  const toks = tokenize(src)
  const vars = new Set<string>()
  let pos = 0
  let depth = 0
  const peek = () => toks[pos] as Tok
  const isOp = (v: string) => {
    const t = peek()
    return t.k === "op" && t.v === v
  }
  const expect = (v: string) => {
    if (!isOp(v)) throw new ExprError(`expected "${v}"`, peek().at)
    pos++
  }

  // expr := term (("+"|"-") term)*
  const expr = (): ExprFn => {
    if (++depth > 64) throw new ExprError("expression is nested too deeply", peek().at)
    let left = term()
    while (isOp("+") || isOp("-")) {
      const op = (toks[pos++] as Tok & { v: string }).v
      const a = left
      const b = term()
      left = op === "+" ? (s) => a(s) + b(s) : (s) => a(s) - b(s)
    }
    depth--
    return left
  }
  // term := unary (("*"|"/") unary)*
  const term = (): ExprFn => {
    let left = unary()
    while (isOp("*") || isOp("/")) {
      const op = (toks[pos++] as Tok & { v: string }).v
      const a = left
      const b = unary()
      left = op === "*" ? (s) => a(s) * b(s) : (s) => a(s) / b(s)
    }
    return left
  }
  // unary := "-" unary | power   (so -x^2 = -(x^2))
  const unary = (): ExprFn => {
    if (isOp("-")) {
      pos++
      const a = unary()
      return (s) => -a(s)
    }
    if (isOp("+")) {
      pos++
      return unary()
    }
    return power()
  }
  // power := atom ("^" unary)?
  const power = (): ExprFn => {
    const base = atom()
    if (isOp("^")) {
      pos++
      const exp = unary()
      return (s) => base(s) ** exp(s)
    }
    return base
  }
  const atom = (): ExprFn => {
    const t = peek()
    if (t.k === "num") {
      pos++
      const v = t.v
      return () => v
    }
    if (t.k === "op" && t.v === "(") {
      pos++
      const inner = expr()
      expect(")")
      return inner
    }
    if (t.k === "id") {
      pos++
      const name = t.v
      if (isOp("(")) {
        pos++
        const args: Array<ExprFn> = [expr()]
        while (isOp(",")) {
          pos++
          args.push(expr())
        }
        expect(")")
        const f1 = fns1[name]
        if (f1 !== undefined) {
          if (args.length !== 1) throw new ExprError(`${name}() takes one argument`, t.at)
          const a = args[0] as ExprFn
          return (s) => f1(a(s))
        }
        const fn = fnsN[name]
        if (fn !== undefined) return (s) => fn(...args.map((a) => a(s)))
        throw new ExprError(`unknown function "${name}"`, t.at)
      }
      const c = consts[name]
      if (c !== undefined) return () => c
      vars.add(name)
      // A missing variable is NaN, so a broken binding draws nothing instead of a wrong line.
      return (s) => (Object.hasOwn(s, name) ? (s[name] as number) : Number.NaN)
    }
    throw new ExprError(t.k === "end" ? "unexpected end of expression" : "unexpected token", t.at)
  }

  const fn = expr()
  if (peek().k !== "end") throw new ExprError("unexpected token", peek().at)
  return { fn, vars: [...vars] }
}
