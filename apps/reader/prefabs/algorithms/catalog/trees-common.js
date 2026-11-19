// Trees as text, for the trees' inputs: a binary tree "A(B, C(D, E))" (a missing child "-":
// "A(-, C)"), a general tree "A(B(E), C(F, G), D)". Nodes get ids in preorder (n0, n1…), so
// the same text gives the same ids and the player can slide a node that moves.

function tokens(text) {
  const out = [];
  const re = /\s*([(),]|[^(),\s]+)/gy;
  let m;
  const s = String(text || '');
  re.lastIndex = 0;
  while (re.lastIndex < s.length && (m = re.exec(s))) out.push(m[1]);
  if (s.slice(re.lastIndex).trim()) throw Error(`Cannot read the tree near "${s.slice(re.lastIndex, re.lastIndex + 10)}"`);
  return out;
}
// → { id, label, children: [node|null] } (null: "-"), or null for an empty text.
function parse(text, most = 63) {
  const tk = tokens(text);
  if (!tk.length) return null;
  let i = 0, n = 0;
  const node = () => {
    const label = tk[i++];
    if (label === undefined || '(),'.includes(label)) throw Error('A value is missing in the tree');
    if (label === '-') return null;
    if (++n > most) throw Error(`At most ${most} nodes`);
    const me = { id: `n${n - 1}`, label: /^-?\d+$/.test(label) ? Number(label) : label, children: [] };
    if (tk[i] === '(') {
      i++;
      for (;;) {
        me.children.push(node());
        if (tk[i] === ',') { i++; continue; }
        if (tk[i] === ')') { i++; break; }
        throw Error('A ")" is missing in the tree');
      }
    }
    return me;
  };
  const root = node();
  if (i < tk.length) throw Error(`Something after the tree: "${tk[i]}"`);
  return root;
}
export function parseBinary(text) {
  const conv = (g) => {
    if (!g) return null;
    if (g.children.length > 2) throw Error(`${g.label} has more than two children`);
    return { id: g.id, label: g.label, left: conv(g.children[0] || null), right: conv(g.children[1] || null) };
  };
  return conv(parse(text));
}
export function parseGeneral(text) {
  const conv = (g) => (g ? { id: g.id, label: g.label, children: g.children.filter(Boolean).map(conv) } : null);
  return conv(parse(text));
}
export function binaryText(n) {
  if (!n) return '-';
  if (!n.left && !n.right) return String(n.label);
  return `${n.label}(${binaryText(n.left)}, ${binaryText(n.right)})`;
}
export function generalText(n) {
  if (!n) return '';
  return n.children?.length ? `${n.label}(${n.children.map(generalText).join(', ')})` : String(n.label);
}
export const cloneTree = (n) => (n ? structuredClone(n) : null);
