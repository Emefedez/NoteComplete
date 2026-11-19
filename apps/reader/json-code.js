// JSON text boxes in the figure editors: where a JSON error is, and a box with line numbers
// that marks the line of an error behind its text.
import { highlightLines } from './code-highlight.js';

// Where JSON.parse stopped: { line, column, index, message } (1-based line and column), from
// the error's own words ("at position 42", or "line 3 column 5"). Safari says neither
// ("JSON Parse error: Unexpected identifier"), so where the words give no place the text is
// read here to find it.
export function jsonErrorAt(text, error) {
  const msg = String(error?.message || error || '');
  let index = null;
  const lc = msg.match(/line (\d+) column (\d+)/i);
  if (lc) {
    const lines = text.split('\n');
    index = lines.slice(0, Number(lc[1]) - 1).reduce((n, l) => n + l.length + 1, 0) + Number(lc[2]) - 1;
  } else {
    const pos = msg.match(/position (\d+)/i);
    if (pos) index = Number(pos[1]);
  }
  const found = jsonProblem(text);
  if (index === null && found) index = found.index;
  if (index === null) return { line: null, column: null, index: null, message: msg };
  index = Math.max(0, Math.min(text.length, index));
  const before = text.slice(0, index);
  const line = before.split('\n').length;
  const column = index - before.lastIndexOf('\n');
  // The reason without where (that is said separately), and without the text quoted back.
  let reason = msg.replace(/\s*\(line \d+ column \d+\)/i, '').replace(/\s*(in JSON )?at position \d+.*$/i, '').replace(/,\s*".*$/s, '').replace(/^JSON\.parse:\s*/i, '').replace(/^JSON Parse error:\s*/i, '');
  // Safari's words are vague ("Unexpected identifier"): the scanner's say what was expected.
  if (found && (!reason || !/position|line \d+/i.test(msg))) reason = found.message;
  return { line, column, index, message: reason || 'Not valid JSON' };
}

// The first place `text` is not JSON: { index, message }, or null when it is.
export function jsonProblem(text) {
  let i = 0;
  const fail = (message, at = i) => { throw { index: at, message }; };
  const ws = () => { while (i < text.length && ' \t\n\r'.includes(text[i])) i++; };
  const show = (c) => (c === undefined ? 'the end' : c === '\n' ? 'a line break' : `“${c}”`);
  function string() {
    const start = i++;
    while (i < text.length) {
      const c = text[i];
      if (c === '"') { i++; return; }
      if (c === '\n') fail('A text in quotes runs past the end of its line: a closing " is missing', start);
      if (c === '\\') {
        const e = text[i + 1];
        if (e === 'u') { if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) fail('\\u needs four hex digits'); i += 6; continue; }
        if (!'"\\/bfnrt'.includes(e)) fail(`Unknown escape \\${e ?? ''}`);
        i += 2; continue;
      }
      if (c < ' ') fail('A control character inside a text in quotes');
      i++;
    }
    fail('A text in quotes is not closed: a " is missing', start);
  }
  function number() {
    const m = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i));
    if (!m || !m[0] || m[0] === '-') fail(`Expected a value, found ${show(text[i])}`);
    i += m[0].length;
  }
  function value() {
    ws();
    const c = text[i];
    if (c === '{') return object();
    if (c === '[') return array();
    if (c === '"') return string();
    if (c === '-' || (c >= '0' && c <= '9')) return number();
    for (const word of ['true', 'false', 'null']) if (text.startsWith(word, i)) { i += word.length; return; }
    if (c === "'") fail('Texts go in double quotes ("), not single ones');
    fail(c === undefined ? 'The text ends where a value was expected' : `Expected a value, found ${show(c)}`);
  }
  function object() {
    i++; ws();
    if (text[i] === '}') { i++; return; }
    for (;;) {
      ws();
      if (text[i] === '}') fail('A comma before } is not allowed in JSON', i);
      if (text[i] !== '"') fail(text[i] === undefined ? 'The text ends inside { }: a } is missing' : `Expected a name in double quotes, found ${show(text[i])}`);
      string(); ws();
      if (text[i] !== ':') fail(`Expected : after the name, found ${show(text[i])}`);
      i++;
      value(); ws();
      if (text[i] === ',') { i++; continue; }
      if (text[i] === '}') { i++; return; }
      fail(text[i] === undefined ? 'The text ends inside { }: a } is missing' : `Expected , or } after a value, found ${show(text[i])}`);
    }
  }
  function array() {
    i++; ws();
    if (text[i] === ']') { i++; return; }
    for (;;) {
      ws();
      if (text[i] === ']') fail('A comma before ] is not allowed in JSON', i);
      value(); ws();
      if (text[i] === ',') { i++; continue; }
      if (text[i] === ']') { i++; return; }
      fail(text[i] === undefined ? 'The text ends inside [ ]: a ] is missing' : `Expected , or ] after a value, found ${show(text[i])}`);
    }
  }
  try {
    value(); ws();
    if (i < text.length) fail(`Something after the end: ${show(text[i])}`);
    return null;
  } catch (e) {
    if (e && typeof e.index === 'number') return { index: Math.min(e.index, text.length), message: e.message };
    throw e;
  }
}

const make = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c !== null && c !== undefined && c !== false));
  return node;
};

// A JSON text box with line numbers, coloured (code-highlight.js), and the line of an error
// marked behind its text. The coloured copy sits behind the textarea, whose own letters are
// transparent (its caret, selection and editing stay native).
export function codeBox(textarea) {
  const gutter = make('pre', { className: 'json-gutter' });
  gutter.setAttribute('aria-hidden', 'true');
  const lines = make('div', { className: 'json-lines' });
  const back = make('pre', { className: 'json-back json-tokens' }, lines);
  back.setAttribute('aria-hidden', 'true');
  textarea.classList.add('json-input');
  const box = make('div', { className: 'json-code' }, gutter, make('div', { className: 'json-edit' }, back, textarea));
  let bad = null;
  const follow = () => {
    gutter.scrollTop = textarea.scrollTop;
    // Moved rather than scrolled: the copy behind cannot always scroll as far as the textarea.
    lines.style.transform = `translate(${-textarea.scrollLeft}px, ${-textarea.scrollTop}px)`;
  };
  const paint = () => {
    const text = textarea.value;
    const coloured = highlightLines(text, 'json');
    gutter.textContent = coloured.map((_, i) => i + 1).join('\n');
    lines.innerHTML = coloured.map((html, i) => `<span${i + 1 === bad ? ' class="json-bad"' : ''}>${html}\n</span>`).join('');
    follow();
  };
  textarea.addEventListener('input', paint);
  textarea.addEventListener('scroll', follow);
  paint();
  return {
    box,
    paint,
    mark(line) { bad = line; paint(); box.classList.toggle('has-error', !!line); },
    // Puts the caret where the error is, with its line in view.
    go(index) {
      textarea.focus();
      textarea.setSelectionRange(index, Math.min(textarea.value.length, index + 1));
      const line = textarea.value.slice(0, index).split('\n').length;
      const h = parseFloat(getComputedStyle(textarea).lineHeight) || 17;
      textarea.scrollTop = Math.max(0, (line - 3) * h);
    },
  };
}
