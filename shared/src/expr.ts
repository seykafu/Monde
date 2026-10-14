/**
 * Safe evaluator for authored conditions: canon-lock `while` clauses (GDD §9.3), scene triggers and
 * `[[if …]]` branches (§13.1). Never uses eval.
 *
 * Grammar:  or := and ('||' and)* · and := unary ('&&' unary)* · unary := '!' unary | cmp
 *           cmp := atom (('=='|'!='|'<'|'<='|'>'|'>=') atom)? · atom := number | 'str' | "str" | true | false
 *                  | path | '(' or ')'          path := ident ('.' ident)*
 * Paths resolve through `ctx.resolve(path)`. Unknown paths resolve to undefined (falsy), never throw.
 */

export interface ExprContext {
  resolve(path: string[]): unknown;
}

type Tok = { t: "num"; v: number } | { t: "str"; v: string } | { t: "id"; v: string } | { t: "op"; v: string };

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) { i++; continue; }
    const two = src.slice(i, i + 2);
    if (["&&", "||", "==", "!=", "<=", ">="].includes(two)) { out.push({ t: "op", v: two }); i += 2; continue; }
    if ("!<>().".includes(c)) { out.push({ t: "op", v: c }); i++; continue; }
    if (c === "'" || c === '"') {
      const end = src.indexOf(c, i + 1);
      if (end < 0) throw new Error(`unterminated string in: ${src}`);
      out.push({ t: "str", v: src.slice(i + 1, end) }); i = end + 1; continue;
    }
    const num = /^-?\d+(\.\d+)?/.exec(src.slice(i));
    if (num) { out.push({ t: "num", v: Number(num[0]) }); i += num[0].length; continue; }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
    if (id) { out.push({ t: "id", v: id[0] }); i += id[0].length; continue; }
    throw new Error(`unexpected '${c}' in: ${src}`);
  }
  return out;
}

export function evaluate(src: string, ctx: ExprContext): boolean {
  const toks = lex(src);
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => peek()?.t === "op" && peek()!.v === v;
  const eat = (v: string) => { if (!isOp(v)) throw new Error(`expected '${v}' in: ${src}`); p++; };

  function atom(): unknown {
    const tk = toks[p++];
    if (!tk) throw new Error(`unexpected end of: ${src}`);
    if (tk.t === "num" || tk.t === "str") return tk.v;
    if (tk.t === "op" && tk.v === "(") { const v = or(); eat(")"); return v; }
    if (tk.t === "id") {
      if (tk.v === "true") return true;
      if (tk.v === "false") return false;
      const path = [tk.v];
      while (isOp(".")) { p++; const nx = toks[p++]; if (nx?.t !== "id") throw new Error(`bad path in: ${src}`); path.push(nx.v); }
      return ctx.resolve(path);
    }
    throw new Error(`unexpected '${tk.v}' in: ${src}`);
  }
  function cmp(): unknown {
    const left = atom();
    const tk = peek();
    if (tk?.t === "op" && ["==", "!=", "<", "<=", ">", ">="].includes(tk.v)) {
      p++;
      const right = atom();
      switch (tk.v) {
        case "==": return left === right;
        case "!=": return left !== right;
        case "<": return Number(left) < Number(right);
        case "<=": return Number(left) <= Number(right);
        case ">": return Number(left) > Number(right);
        case ">=": return Number(left) >= Number(right);
      }
    }
    return left;
  }
  function unary(): unknown { if (isOp("!")) { p++; return !unary(); } return cmp(); }
  function and(): unknown { let v = unary(); while (isOp("&&")) { p++; const r = unary(); v = Boolean(v) && Boolean(r); } return v; }
  function or(): unknown { let v = and(); while (isOp("||")) { p++; const r = and(); v = Boolean(v) || Boolean(r); } return v; }

  if (src.trim() === "") return true;
  const result = or();
  if (p !== toks.length) throw new Error(`trailing tokens in: ${src}`);
  return Boolean(result);
}

/** Standard game context: flags, day, regard.<id>, pillar.<name>, census, player.*, count.*, coins. */
export function gameContext(state: {
  flags: ReadonlySet<string>;
  values?: Record<string, unknown>;
}): ExprContext {
  return {
    resolve(path) {
      if (path[0] === "flag" && path.length === 2) return state.flags.has(path[1]!);
      let cur: unknown = state.values;
      for (const key of path) {
        if (cur && typeof cur === "object" && key in (cur as Record<string, unknown>)) cur = (cur as Record<string, unknown>)[key];
        else return undefined;
      }
      return cur;
    },
  };
}
