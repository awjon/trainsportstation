// Tiny DOM helpers for the overlay UI (docs/30 §10 — plain DOM, no UI framework, no new
// dependency). Everything here is a thin wrapper over `document`, so it is only ever called
// from a `mount()`; the view-model functions that sit alongside it stay pure and headless.

export interface ElOptions {
  class?: string;
  text?: string;
  html?: string;
  attrs?: Record<string, string>;
  style?: Partial<CSSStyleDeclaration>;
  on?: Partial<Record<keyof HTMLElementEventMap, (e: Event) => void>>;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  opts: ElOptions = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (opts.class) node.className = opts.class;
  if (opts.text !== undefined) node.textContent = opts.text;
  if (opts.html !== undefined) node.innerHTML = opts.html;
  for (const [k, v] of Object.entries(opts.attrs ?? {})) node.setAttribute(k, v);
  Object.assign(node.style, opts.style ?? {});
  for (const [type, fn] of Object.entries(opts.on ?? {})) {
    node.addEventListener(type, fn as EventListener);
  }
  for (const c of children) node.append(c);
  return node;
}

/** An SVG element (the countdown radial is SVG so it stays crisp at any UI scale). */
export function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
): SVGElementTagNameMap[K] {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

/** A chunky action button — minimum 44px touch target is enforced in styles.css. */
export function button(label: string, onClick: () => void, cls = 'btn'): HTMLButtonElement {
  return el('button', { class: cls, text: label, attrs: { type: 'button' }, on: { click: onClick } });
}

export function clear(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function show(node: HTMLElement, visible: boolean): void {
  node.classList.toggle('hidden', !visible);
}
