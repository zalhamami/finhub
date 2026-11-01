/** True when keystrokes in `el` are text input (a single-key shortcut must stay out of the way). */
export function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return true;
  if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') return true;
  return el.getAttribute('role') === 'textbox' || el.getAttribute('role') === 'combobox';
}
