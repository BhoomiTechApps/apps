/* Deterministic checks used by "Check correctness".
 *
 * 1. Propositional logic: parses formulas such as "(P -> Q) & P" and decides
 *    by truth table whether a conclusion follows from premises.
 * 2. Arithmetic: evaluates expressions such as "sqrt(2)^2 * 3" without eval().
 *
 * These run in the app, not in the AI model, so their answers can't be
 * talked round by a persuasive but wrong explanation.
 */
(function (root) {
  'use strict';

  /* ---------------------------------------------------------------------
   * Propositional logic
   * ------------------------------------------------------------------- */
  const OPS = [
    ['<->', 'iff'], ['<=>', 'iff'], ['↔', 'iff'], ['≡', 'iff'],
    ['->', 'imp'], ['=>', 'imp'], ['→', 'imp'], ['⊃', 'imp'],
    ['&&', 'and'], ['&', 'and'], ['∧', 'and'], ['·', 'and'],
    ['||', 'or'], ['|', 'or'], ['∨', 'or'], ['+', 'or'],
    ['⊕', 'xor'], ['⊻', 'xor'],
    ['~', 'not'], ['!', 'not'], ['¬', 'not'], ['-', 'not'],
    ['(', '('], [')', ')'], ['[', '('], [']', ')'],
    ['⊤', 'true'], ['⊥', 'false'],
  ];
  const WORDS = { and: 'and', or: 'or', not: 'not', implies: 'imp', iff: 'iff', xor: 'xor', true: 'true', false: 'false' };

  function tokenizeFormula(src) {
    const tokens = [];
    let i = 0;
    const s = String(src);
    while (i < s.length) {
      if (/\s/.test(s[i])) { i++; continue; }
      const op = OPS.find(([sym]) => s.startsWith(sym, i));
      if (op) { tokens.push({ t: op[1] }); i += op[0].length; continue; }
      const m = /^[A-Za-z_][A-Za-z0-9_']*/.exec(s.slice(i));
      if (m) {
        const w = m[0];
        const lw = w.toLowerCase();
        if (WORDS[lw] && w !== 'T' && w !== 'F') tokens.push({ t: WORDS[lw] });
        else tokens.push({ t: 'var', v: w });
        i += w.length;
        continue;
      }
      throw new Error(`Unexpected character "${s[i]}" in formula "${s}".`);
    }
    return tokens;
  }

  function parseFormula(src) {
    const tokens = tokenizeFormula(src);
    let pos = 0;
    const peek = () => tokens[pos] && tokens[pos].t;
    const take = (t) => { if (peek() !== t) throw new Error(`Formula "${src}" is malformed near token ${pos + 1}.`); pos++; };

    function iff() {
      let left = imp();
      while (peek() === 'iff' || peek() === 'xor') {
        const op = tokens[pos++].t;
        left = { op, a: left, b: imp() };
      }
      return left;
    }
    function imp() {
      const left = or();
      if (peek() === 'imp') { pos++; return { op: 'imp', a: left, b: imp() }; } // right-associative
      return left;
    }
    function or() {
      let left = and();
      while (peek() === 'or') { pos++; left = { op: 'or', a: left, b: and() }; }
      return left;
    }
    function and() {
      let left = not();
      while (peek() === 'and') { pos++; left = { op: 'and', a: left, b: not() }; }
      return left;
    }
    function not() {
      if (peek() === 'not') { pos++; return { op: 'not', a: not() }; }
      return atom();
    }
    function atom() {
      const tk = tokens[pos];
      if (!tk) throw new Error(`Formula "${src}" ends too early.`);
      if (tk.t === '(') { pos++; const e = iff(); take(')'); return e; }
      if (tk.t === 'var') { pos++; return { op: 'var', name: tk.v }; }
      if (tk.t === 'true' || tk.t === 'false') { pos++; return { op: 'const', value: tk.t === 'true' }; }
      throw new Error(`Formula "${src}" is malformed near token ${pos + 1}.`);
    }

    if (!tokens.length) throw new Error('Empty formula.');
    const tree = iff();
    if (pos !== tokens.length) throw new Error(`Formula "${src}" has extra symbols after position ${pos}.`);
    return tree;
  }

  function evalFormula(node, env) {
    switch (node.op) {
      case 'var': return Boolean(env[node.name]);
      case 'const': return node.value;
      case 'not': return !evalFormula(node.a, env);
      case 'and': return evalFormula(node.a, env) && evalFormula(node.b, env);
      case 'or': return evalFormula(node.a, env) || evalFormula(node.b, env);
      case 'imp': return !evalFormula(node.a, env) || evalFormula(node.b, env);
      case 'iff': return evalFormula(node.a, env) === evalFormula(node.b, env);
      case 'xor': return evalFormula(node.a, env) !== evalFormula(node.b, env);
      default: throw new Error(`Unknown operator ${node.op}`);
    }
  }

  function collectVars(node, set = new Set()) {
    if (node.op === 'var') set.add(node.name);
    if (node.a) collectVars(node.a, set);
    if (node.b) collectVars(node.b, set);
    return set;
  }

  /**
   * Decides whether `conclusion` follows from `premises` by checking every
   * assignment of true/false to the variables.
   * Returns { valid, premisesConsistent, counterexample, variables, rowsChecked }.
   */
  function checkArgument(premises, conclusion, maxVars = 16) {
    const pTrees = premises.map(parseFormula);
    const cTree = parseFormula(conclusion);
    const vars = new Set();
    pTrees.forEach((t) => collectVars(t, vars));
    collectVars(cTree, vars);
    const names = [...vars].sort();
    if (names.length > maxVars) throw new Error(`Too many variables (${names.length}); the limit is ${maxVars}.`);

    let counterexample = null;
    let premisesConsistent = false;
    const rows = 2 ** names.length;
    for (let mask = 0; mask < rows; mask++) {
      const env = {};
      names.forEach((n, i) => { env[n] = Boolean(mask & (1 << i)); });
      const allPremises = pTrees.every((t) => evalFormula(t, env));
      if (!allPremises) continue;
      premisesConsistent = true;
      if (!evalFormula(cTree, env) && !counterexample) counterexample = env;
    }
    return { valid: !counterexample, premisesConsistent, counterexample, variables: names, rowsChecked: rows };
  }

  /* ---------------------------------------------------------------------
   * Arithmetic
   * ------------------------------------------------------------------- */
  const FUNCS = {
    sqrt: Math.sqrt, abs: Math.abs, exp: Math.exp, ln: Math.log, log: Math.log10, log10: Math.log10, log2: Math.log2,
    sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
    floor: Math.floor, ceil: Math.ceil, round: Math.round,
    fact: (n) => {
      if (!Number.isInteger(n) || n < 0 || n > 170) throw new Error('fact() needs a whole number from 0 to 170.');
      let r = 1; for (let i = 2; i <= n; i++) r *= i; return r;
    },
  };
  const CONSTS = { pi: Math.PI, 'π': Math.PI, e: Math.E };

  function evalArithmetic(src) {
    const s = String(src).replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/\*\*/g, '^').replace(/,(?=\d{3}\b)/g, '');
    const tokens = [];
    const re = /\s*(?:(\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\.\d+)|([A-Za-zπ_][A-Za-z0-9_]*)|(\S))/y;
    let m;
    while (re.lastIndex < s.length && (m = re.exec(s))) {
      if (m[1] !== undefined) tokens.push({ t: 'num', v: parseFloat(m[1]) });
      else if (m[2] !== undefined) tokens.push({ t: 'id', v: m[2].toLowerCase() === 'pi' ? 'pi' : m[2] });
      else if ('+-*/^%()!'.includes(m[3])) tokens.push({ t: m[3] });
      else throw new Error(`Unexpected "${m[3]}" in expression.`);
    }
    let pos = 0;
    const peek = () => tokens[pos] && tokens[pos].t;

    function expr() {
      let v = term();
      while (peek() === '+' || peek() === '-') { const op = tokens[pos++].t; const r = term(); v = op === '+' ? v + r : v - r; }
      return v;
    }
    function term() {
      let v = unary();
      while (peek() === '*' || peek() === '/' || peek() === '%') {
        const op = tokens[pos++].t; const r = unary();
        if (op === '*') v *= r; else if (op === '/') v /= r; else v %= r;
      }
      return v;
    }
    function unary() {
      if (peek() === '-') { pos++; return -unary(); }
      if (peek() === '+') { pos++; return unary(); }
      return power();
    }
    function power() {
      const base = postfix();
      if (peek() === '^') { pos++; return Math.pow(base, unary()); } // right-associative, binds tighter than unary minus on the left
      return base;
    }
    function postfix() {
      let v = primary();
      while (peek() === '!') { pos++; v = FUNCS.fact(v); }
      return v;
    }
    function primary() {
      const tk = tokens[pos];
      if (!tk) throw new Error('Expression ends too early.');
      if (tk.t === 'num') { pos++; return tk.v; }
      if (tk.t === '(') { pos++; const v = expr(); if (peek() !== ')') throw new Error('Missing ")".'); pos++; return v; }
      if (tk.t === 'id') {
        pos++;
        const name = tk.v;
        if (FUNCS[name.toLowerCase()] && peek() === '(') {
          pos++; const arg = expr(); if (peek() !== ')') throw new Error('Missing ")".'); pos++;
          return FUNCS[name.toLowerCase()](arg);
        }
        const c = CONSTS[name] ?? CONSTS[name.toLowerCase()];
        if (c !== undefined) return c;
        throw new Error(`Unknown name "${name}" in expression.`);
      }
      throw new Error('Expression is malformed.');
    }
    const value = expr();
    if (pos !== tokens.length) throw new Error('Expression has extra symbols at the end.');
    if (!Number.isFinite(value)) throw new Error('The result is not a finite number (for example, division by zero).');
    return value;
  }

  /** Compares a computed value with a claimed one, allowing for the rounding shown in the claim. */
  function compareClaim(computed, claimed) {
    if (claimed === null || claimed === undefined || claimed === '') return { comparable: false };
    const text = String(claimed).trim();
    const pct = /%$/.test(text);
    const num = parseFloat(text.replace(/[, ]/g, '').replace(/%$/, ''));
    if (!Number.isFinite(num)) return { comparable: false };
    const target = pct ? num / 100 : num;
    const decimals = (text.replace(/%$/, '').split('.')[1] || '').replace(/\D.*/, '').length;
    const tolerance = Math.max(0.5 * 10 ** -decimals * (pct ? 0.01 : 1), Math.abs(target) * 1e-9, 1e-12);
    const directMatch = Math.abs(computed - target) <= tolerance;
    const pctMatch = !pct && Math.abs(computed * 100 - num) <= Math.max(0.5 * 10 ** -decimals, 1e-9); // "0.25" vs "25"
    const exact = Math.abs(computed - target) <= Math.max(Math.abs(target) * 1e-9, 1e-12);
    return { comparable: true, matches: directMatch, exact: directMatch && exact, claimedValue: target, looseMatch: !directMatch && pctMatch };
  }

  const api = { parseFormula, checkArgument, evalArithmetic, compareClaim };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TracerLogic = api;
})(typeof window !== 'undefined' ? window : globalThis);
