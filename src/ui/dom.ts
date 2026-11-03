// Tiny DOM helpers (no framework needed for a UI this size).

type Attrs = Record<string, string | number | boolean | EventListener | undefined | null>;
type Child = Node | string | number | null | undefined | false | Child[];

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k === 'html') el.innerHTML = String(v);
    else if (k === 'style') el.setAttribute('style', String(v));
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  append(el, children);
  return el;
}

function append(el: Node, children: Child[]) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
}

export function clear(el: Element) { while (el.firstChild) el.removeChild(el.firstChild); }

export function fmtPop(p: number): string {
  if (p >= 1e6) return (p / 1e6).toFixed(p >= 1e7 ? 0 : 1) + 'M';
  if (p >= 1e4) return Math.round(p / 1000) + 'k';
  if (p >= 1000) return (p / 1000).toFixed(1) + 'k';
  return String(Math.round(p / 10) * 10);
}

export function fmtPopLong(p: number): string {
  if (p >= 1e6) return (p / 1e6).toFixed(2) + ' million';
  return (Math.round(p / (p >= 1e4 ? 1000 : 10)) * (p >= 1e4 ? 1000 : 10)).toLocaleString('en-US');
}

export const SVGNS = 'http://www.w3.org/2000/svg';
export function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, text?: string): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  if (text !== undefined) el.textContent = text;
  return el;
}
