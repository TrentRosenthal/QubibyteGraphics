/**
 * Finite automata: DFA and NFA simulation with the state trace for each
 * input symbol, epsilon closures, and the subset construction (NFA to DFA)
 * with the discovered subsets.
 * @module math/automata
 */

/**
 * @typedef {object} DFA
 * @property {string[]} states
 * @property {string[]} alphabet
 * @property {Record<string, Record<string, string>>} transitions state -> symbol -> state
 * @property {string} start
 * @property {string[]} accept
 */

/**
 * @typedef {object} NFA
 * @property {string[]} states
 * @property {string[]} alphabet
 * @property {Record<string, Record<string, string[]>>} transitions state -> symbol ('' for epsilon) -> states
 * @property {string} start
 * @property {string[]} accept
 */

/**
 * Run a DFA on an input string.
 * @param {DFA} dfa
 * @param {string|string[]} input
 * @returns {{accepted: boolean, trace: {symbol: string|null, state: string|null}[], reason?: string}}
 */
export function runDFA(dfa, input) {
  const symbols = typeof input === 'string' ? [...input] : input;
  let state = dfa.start;
  const trace = [{ symbol: null, state }];
  for (const sym of symbols) {
    const next = dfa.transitions[state] && dfa.transitions[state][sym];
    if (next === undefined) {
      trace.push({ symbol: sym, state: null });
      return { accepted: false, trace, reason: 'No transition from ' + state + ' on ' + sym };
    }
    state = next;
    trace.push({ symbol: sym, state });
  }
  return { accepted: dfa.accept.includes(state), trace };
}

/**
 * Epsilon closure of a set of NFA states.
 * @param {NFA} nfa
 * @param {Iterable<string>} states
 * @returns {string[]} sorted state names
 */
export function epsilonClosure(nfa, states) {
  const out = new Set(states);
  const stack = [...out];
  while (stack.length) {
    const s = stack.pop();
    for (const t of (nfa.transitions[s] && nfa.transitions[s]['']) || []) {
      if (!out.has(t)) {
        out.add(t);
        stack.push(t);
      }
    }
  }
  return [...out].sort();
}

function move(nfa, states, sym) {
  const out = new Set();
  for (const s of states) for (const t of (nfa.transitions[s] && nfa.transitions[s][sym]) || []) out.add(t);
  return out;
}

/**
 * Run an NFA (with epsilon moves) on an input, tracing the set of active
 * states after each symbol.
 * @param {NFA} nfa
 * @param {string|string[]} input
 * @returns {{accepted: boolean, trace: {symbol: string|null, states: string[]}[]}}
 */
export function runNFA(nfa, input) {
  const symbols = typeof input === 'string' ? [...input] : input;
  let cur = epsilonClosure(nfa, [nfa.start]);
  const trace = [{ symbol: null, states: cur }];
  for (const sym of symbols) {
    cur = epsilonClosure(nfa, move(nfa, cur, sym));
    trace.push({ symbol: sym, states: cur });
  }
  return { accepted: cur.some((s) => nfa.accept.includes(s)), trace };
}

/**
 * Subset construction: an equivalent DFA whose states are sets of NFA
 * states (named like "{q0,q1}"; the empty set is the dead state "{}").
 * @param {NFA} nfa
 * @returns {{dfa: DFA, subsets: Record<string, string[]>, steps: {from: string, symbol: string, to: string, isNew: boolean}[]}}
 */
export function subsetConstruction(nfa) {
  const name = (set) => '{' + set.join(',') + '}';
  const start = epsilonClosure(nfa, [nfa.start]);
  const subsets = { [name(start)]: start };
  const queue = [start];
  const transitions = {};
  const steps = [];
  const alphabet = nfa.alphabet.filter((a) => a !== '');
  while (queue.length) {
    const set = queue.shift();
    const from = name(set);
    transitions[from] = {};
    for (const a of alphabet) {
      const target = epsilonClosure(nfa, move(nfa, set, a));
      const to = name(target);
      const isNew = !(to in subsets);
      if (isNew) {
        subsets[to] = target;
        queue.push(target);
      }
      transitions[from][a] = to;
      steps.push({ from, symbol: a, to, isNew });
    }
  }
  const states = Object.keys(subsets);
  return {
    dfa: {
      states, alphabet, transitions, start: name(start),
      accept: states.filter((s) => subsets[s].some((q) => nfa.accept.includes(q))),
    },
    subsets,
    steps,
  };
}
