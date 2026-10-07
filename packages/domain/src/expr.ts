// Safe expressions for the `plot` widget (curves, points, readouts). Parsed once to an AST, then
// compiled to a closure. No eval, no Function, no property access: only numbers, variables, the
// constants pi and e, + - * / ^, unary minus, parentheses and the functions in `functions`.
//
//   expr    := term (("+" | "-") term)*
//   term    := unary (("*" | "/") unary)*
//   unary   := ("-" | "+") unary | power
//   power   := primary ("^" unary)?          right-associative: 2^3^2 = 2^9, -x^2 = -(x^2)
//   primary := number | name | name "(" args ")" | "(" expr ")"

import { Result, Schema } from "effect"

export type BinaryOp = "+" | "-" | "*" | "/" | "^"

export type ExprAst =
  | { readonly type: "num"; readonly value: number }
  | { readonly type: "const"; readonly name: "pi" | "e" }
  | { readonly type: "var"; readonly name: string }
  | { readonly type: "neg"; readonly arg: ExprAst }
  | { readonly type: "bin"; readonly op: BinaryOp; readonly left: ExprAst; readonly right: ExprAst }
  | { readonly type: "call"; readonly fn: FunctionName; readonly args: ReadonlyArray<ExprAst> }

export class ExprError extends Schema.TaggedError<ExprError>()("ExprError", {
  expr: Schema.String,
  // Character offset of the problem in `expr`.
  at: Schema.Number,
  reason: Schema.String,
}) {
  override get message(): string {
    return `${this.reason} at ${this.at} in "${this.expr}"`
  }
}

type Fn = (...args: ReadonlyArray<number>) => number
interface FnSpec {
  readonly min: number
  readonly max: number
  readonly fn: Fn
}

const unary = (f: (x: number) => number): FnSpec => ({ min: 1, max: 1, fn: (x) => f(x ?? Number.NaN) })
const binary = (f: (x: number, y: number) => number): FnSpec => ({
  min: 2,
  max: 2,
  fn: (x, y) => f(x ?? Number.NaN, y ?? Number.NaN),
})
const variadic = (f: (...xs: ReadonlyArray<number>) => number): FnSpec => ({ min: 1, max: 16, fn: f })

const functionTable = {
  sin: unary(Math.sin),
  cos: unary(Math.cos),
  tan: unary(Math.tan),
  asin: unary(Math.asin),
  acos: unary(Math.acos),
  atan: unary(Math.atan),
  atan2: binary(Math.atan2),
  sinh: unary(Math.sinh),
  cosh: unary(Math.cosh),
  tanh: unary(Math.tanh),
  sqrt: unary(Math.sqrt),
  cbrt: unary(Math.cbrt),
  abs: unary(Math.abs),
  exp: unary(Math.exp),
  ln: unary(Math.log),
  log: unary(Math.log10),
  log2: unary(Math.log2),
  floor: unary(Math.floor),
  ceil: unary(Math.ceil),
  round: unary(Math.round),
  sign: unary(Math.sign),
  pow: binary(Math.pow),
  mod: binary((x, y) => x - y * Math.floor(x / y)),
  min: variadic((...xs) => Math.min(...xs)),
  max: variadic((...xs) => Math.max(...xs)),
  hypot: variadic((...xs) => Math.hypot(...xs)),
} satisfies Record<string, FnSpec>

export type FunctionName = keyof typeof functionTable

/** Every function name the expression language knows, with its arity range. */
export const functions: ReadonlyMap<FunctionName, { readonly min: number; readonly max: number }> = new Map(
  (Object.keys(functionTable) as Array<FunctionName>).map((name) => [
    name,
    { min: functionTable[name].min, max: functionTable[name].max },
  ]),
)

const isFunctionName = (name: string): name is FunctionName => Object.hasOwn(functionTable, name)

/** Names that cannot be variables (param ids): constants and function names. */
export const isReservedName = (name: string): boolean => name === "pi" || name === "e" || isFunctionName(name)

type Token =
  | { readonly kind: "num"; readonly value: number; readonly at: number }
  | { readonly kind: "name"; readonly name: string; readonly at: number }
  | { readonly kind: "op"; readonly op: string; readonly at: number }
  | { readonly kind: "end"; readonly at: number }

const numberPattern = /(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/y
const namePattern = /[A-Za-z_][A-Za-z0-9_]*/y
const maxLength = 1_000
const maxDepth = 64

class Fail {
  constructor(
    readonly at: number,
    readonly reason: string,
  ) {}
}

const tokenize = (src: string): Array<Token> | Fail => {
  const tokens: Array<Token> = []
  let i = 0
  while (i < src.length) {
    const c = src[i] ?? ""
    if (/\s/u.test(c)) {
      i++
      continue
    }
    numberPattern.lastIndex = i
    const num = numberPattern.exec(src)
    if (num !== null) {
      tokens.push({ kind: "num", value: Number(num[0]), at: i })
      i += num[0].length
      continue
    }
    namePattern.lastIndex = i
    const name = namePattern.exec(src)
    if (name !== null) {
      tokens.push({ kind: "name", name: name[0], at: i })
      i += name[0].length
      continue
    }
    if ("+-*/^(),".includes(c)) {
      tokens.push({ kind: "op", op: c, at: i })
      i++
      continue
    }
    return new Fail(i, `unexpected character "${c}"`)
  }
  tokens.push({ kind: "end", at: src.length })
  return tokens
}

const describe = (t: Token): string =>
  t.kind === "end"
    ? "end of expression"
    : t.kind === "num"
      ? `number ${t.value}`
      : t.kind === "name"
        ? `"${t.name}"`
        : `"${t.op}"`

const parseTokens = (tokens: ReadonlyArray<Token>): ExprAst | Fail => {
  let pos = 0
  let depth = 0
  const peek = (): Token => tokens[pos] ?? { kind: "end", at: 0 }
  const isOp = (op: string): boolean => {
    const t = peek()
    return t.kind === "op" && t.op === op
  }

  const expr = (): ExprAst | Fail => {
    let left = term()
    while (!(left instanceof Fail) && (isOp("+") || isOp("-"))) {
      const op = isOp("+") ? "+" : "-"
      pos++
      const right = term()
      if (right instanceof Fail) return right
      left = { type: "bin", op, left, right }
    }
    return left
  }

  const term = (): ExprAst | Fail => {
    let left = unaryExpr()
    while (!(left instanceof Fail) && (isOp("*") || isOp("/"))) {
      const op = isOp("*") ? "*" : "/"
      pos++
      const right = unaryExpr()
      if (right instanceof Fail) return right
      left = { type: "bin", op, left, right }
    }
    return left
  }

  const unaryExpr = (): ExprAst | Fail => {
    if (++depth > maxDepth) return new Fail(peek().at, "expression is nested too deeply")
    try {
      if (isOp("-")) {
        pos++
        const arg = unaryExpr()
        return arg instanceof Fail ? arg : { type: "neg", arg }
      }
      if (isOp("+")) {
        pos++
        return unaryExpr()
      }
      const base = primary()
      if (base instanceof Fail || !isOp("^")) return base
      pos++
      const exponent = unaryExpr()
      return exponent instanceof Fail ? exponent : { type: "bin", op: "^", left: base, right: exponent }
    } finally {
      depth--
    }
  }

  const primary = (): ExprAst | Fail => {
    const t = peek()
    if (t.kind === "num") {
      pos++
      return { type: "num", value: t.value }
    }
    if (t.kind === "op" && t.op === "(") {
      pos++
      const inner = expr()
      if (inner instanceof Fail) return inner
      if (!isOp(")")) return new Fail(peek().at, `expected ")" but found ${describe(peek())}`)
      pos++
      return inner
    }
    if (t.kind === "name") {
      pos++
      if (isOp("(")) {
        if (!isFunctionName(t.name)) return new Fail(t.at, `unknown function "${t.name}"`)
        pos++
        const args: Array<ExprAst> = []
        if (!isOp(")")) {
          for (;;) {
            const arg = expr()
            if (arg instanceof Fail) return arg
            args.push(arg)
            if (isOp(",")) {
              pos++
              continue
            }
            break
          }
        }
        if (!isOp(")")) return new Fail(peek().at, `expected "," or ")" but found ${describe(peek())}`)
        pos++
        const spec = functionTable[t.name]
        if (args.length < spec.min || args.length > spec.max) {
          const want = spec.min === spec.max ? `${spec.min}` : `${spec.min} to ${spec.max}`
          return new Fail(t.at, `${t.name} takes ${want} argument(s), got ${args.length}`)
        }
        return { type: "call", fn: t.name, args }
      }
      if (isFunctionName(t.name)) return new Fail(t.at, `function "${t.name}" needs arguments in ( )`)
      if (t.name === "pi" || t.name === "e") return { type: "const", name: t.name }
      return { type: "var", name: t.name }
    }
    return new Fail(t.at, `expected a number, name or "(" but found ${describe(t)}`)
  }

  const ast = expr()
  if (ast instanceof Fail) return ast
  const rest = peek()
  if (rest.kind !== "end") return new Fail(rest.at, `unexpected ${describe(rest)}`)
  return ast
}

/** Parse an expression. Never throws; a syntax error is an `ExprError` with its offset. */
export const parseExpr = (src: string): Result.Result<ExprAst, ExprError> => {
  const fail = (f: Fail) => Result.fail(new ExprError({ expr: src, at: f.at, reason: f.reason }))
  if (src.length > maxLength)
    return fail(new Fail(maxLength, `expression is longer than ${maxLength} characters`))
  const tokens = tokenize(src)
  if (tokens instanceof Fail) return fail(tokens)
  if (tokens.length === 1) return fail(new Fail(0, "expression is empty"))
  const ast = parseTokens(tokens)
  return ast instanceof Fail ? fail(ast) : Result.succeed(ast)
}

/** Variable names used by an expression (constants excluded), sorted, without duplicates. */
export const freeVars = (ast: ExprAst): ReadonlyArray<string> => {
  const names = new Set<string>()
  const walk = (n: ExprAst): void => {
    switch (n.type) {
      case "var":
        names.add(n.name)
        break
      case "neg":
        walk(n.arg)
        break
      case "bin":
        walk(n.left)
        walk(n.right)
        break
      case "call":
        for (const a of n.args) walk(a)
        break
      case "num":
      case "const":
        break
    }
  }
  walk(ast)
  return [...names].sort()
}

export type Vars = Readonly<Record<string, number>>
export type Compiled = (vars: Vars) => number

/** Compile a parsed expression to a function. A variable missing from `vars` evaluates to NaN. */
export const compileExpr = (ast: ExprAst): Compiled => {
  switch (ast.type) {
    case "num": {
      const v = ast.value
      return () => v
    }
    case "const": {
      const v = ast.name === "pi" ? Math.PI : Math.E
      return () => v
    }
    case "var": {
      const name = ast.name
      return (vars) => (Object.hasOwn(vars, name) ? Number(vars[name]) : Number.NaN)
    }
    case "neg": {
      const arg = compileExpr(ast.arg)
      return (vars) => -arg(vars)
    }
    case "bin": {
      const l = compileExpr(ast.left)
      const r = compileExpr(ast.right)
      switch (ast.op) {
        case "+":
          return (vars) => l(vars) + r(vars)
        case "-":
          return (vars) => l(vars) - r(vars)
        case "*":
          return (vars) => l(vars) * r(vars)
        case "/":
          return (vars) => l(vars) / r(vars)
        case "^":
          return (vars) => l(vars) ** r(vars)
      }
      break
    }
    case "call": {
      const fn = functionTable[ast.fn].fn
      const args = ast.args.map(compileExpr)
      return (vars) => fn(...args.map((a) => a(vars)))
    }
  }
  return () => Number.NaN
}

/** Parse and compile in one go. */
export const compile = (src: string): Result.Result<Compiled, ExprError> =>
  Result.map(parseExpr(src), compileExpr)

/** Parse and evaluate once (tests, readouts). */
export const evaluate = (src: string, vars: Vars): Result.Result<number, ExprError> =>
  Result.map(parseExpr(src), (ast) => compileExpr(ast)(vars))
