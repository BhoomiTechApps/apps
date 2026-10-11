/* LexiPic: guard.js
 *
 * Right-click rules and the text fields' own menu.
 *
 *  - The browser's right-click menu is switched off everywhere in the app: cards, photos, the camera, the tabs
 *    and the dialogs (and long-press callouts on iOS).
 *  - In a text field (filter, Roman and native-script word, description, set and language names, the keyboard
 *    tester) a small menu with only Copy and Paste opens instead: right-click, the keyboard's Menu key or
 *    Shift+F10. It never takes focus from the field. Arrow keys, Enter and Escape work while it is open. Copy is
 *    greyed out when nothing is selected.
 *  - On phones and tablets (touch-only screens) text fields keep the system's long-press selection toolbar,
 *    because a web page cannot change what that toolbar shows.
 *  - The keyboard shortcuts that open the developer tools or view-source are swallowed.
 *
 * This is a deterrent, not protection: the browser has to download the app's .js and .css files to run it, so
 * they can always be read with the browser's own menus. Opening a .js or .css address directly, or fetching one
 * from the console, is sent back to index.html by sw.js (and by the server rules in .htaccess).
 *
 * The menu's look (and the iOS callout rule) is in css/app.css, because the page's Content-Security-Policy
 * blocks injected <style>.
 *
 * A classic script with its own scope, loaded before everything else, so the rules hold even if the app fails.
 */
(function () {
  'use strict';

  const TEXT_TYPES = new Set(['text', 'search', 'url', 'email', 'tel', 'password', 'number']);
  const MAC = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
  const MOD = MAC ? '\u2318' : 'Ctrl+';
  const touchOnly = () => matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;

  let lastPointer = { type: 'mouse', at: 0 };
  let menu = null, items = [], note = null, active = -1;
  let field = null, saved = { s: null, e: null }, at = { x: 0, y: 0 };

  /** The text field an event happened in, or null. */
  function textField(el) {
    if (!(el instanceof Element)) return null;
    if (el.tagName === 'TEXTAREA') return el;
    if (el.tagName === 'INPUT' && TEXT_TYPES.has((el.getAttribute('type') || 'text').toLowerCase())) return el;
    return null;
  }
  // number / email inputs have no selection API; their selectionStart is null
  const hasSelectionApi = (f) => typeof f.selectionStart === 'number';


  // ── styles (own, so the form window gets them too) ──
  // The menu's styles are in css/app.css: the page's Content-Security-Policy does not allow injected <style>.

  // ── developer tools / view-source shortcuts ──
  function isDevShortcut(e) {
    const c = e.code, mod = e.ctrlKey || e.metaKey;
    if (e.key === 'F12') return true;
    if (mod && e.shiftKey && (c === 'KeyI' || c === 'KeyJ' || c === 'KeyC' || c === 'KeyK')) return true;   // DevTools, console, inspector
    if (e.metaKey && e.altKey && (c === 'KeyI' || c === 'KeyJ' || c === 'KeyC' || c === 'KeyU')) return true; // the same on macOS
    if (mod && !e.shiftKey && !e.altKey && c === 'KeyU') return true;                                       // view-source
    return false;
  }

  // ── the menu ──
  function build() {
    menu = document.createElement('div');
    menu.className = 'lp-menu';
    menu.id = 'lp-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Text');
    menu.hidden = true;
    menu.innerHTML =
      '<div class="lp-menu-item" role="menuitem" id="lp-menu-copy" data-act="copy"><span>Copy</span><span class="lp-menu-key">' + MOD + 'C</span></div>' +
      '<div class="lp-menu-item" role="menuitem" id="lp-menu-paste" data-act="paste"><span>Paste</span><span class="lp-menu-key">' + MOD + 'V</span></div>' +
      '<div class="lp-menu-note" role="status" hidden></div>';
    items = Array.from(menu.querySelectorAll('.lp-menu-item'));
    note = menu.querySelector('.lp-menu-note');

    // Pressing on the menu must not move focus out of the field.
    menu.addEventListener('pointerdown', (e) => e.preventDefault());
    menu.addEventListener('mousedown', (e) => e.preventDefault());
    menu.addEventListener('click', (e) => {
      const item = e.target.closest('.lp-menu-item');
      if (item) run(item);
    });
    menu.addEventListener('pointermove', (e) => {
      const item = e.target.closest('.lp-menu-item');
      setActive(item ? items.indexOf(item) : -1);
    });
    menu.addEventListener('pointerleave', () => setActive(-1));
  }

  const isOpen = () => !!menu && !menu.hidden;
  const enabled = (item) => item.getAttribute('aria-disabled') !== 'true';

  function setActive(i) {
    active = i;
    items.forEach((it, k) => it.classList.toggle('active', k === i && enabled(it)));
    if (!field) return;
    if (i >= 0) field.setAttribute('aria-activedescendant', items[i].id); else field.removeAttribute('aria-activedescendant');
  }

  function move(step) {
    const usable = items.map((it, k) => (enabled(it) ? k : -1)).filter((k) => k >= 0);
    if (!usable.length) return;
    const at = usable.indexOf(active);
    setActive(usable[at < 0 ? (step > 0 ? 0 : usable.length - 1) : (at + step + usable.length) % usable.length]);
  }

  function open(f, x, y, fromKeyboard) {
    if (!menu) build();
    if (field && field !== f) field.removeAttribute('aria-activedescendant');
    field = f;
    // Inside the sheet that holds the field: a modal <dialog> sits in the top layer and makes everything
    // outside it inert, so the menu has to live in it to be seen and clicked. Elsewhere, the frame, so the theme applies.
    const host = f.closest('dialog[open]') || document.getElementById('lp-frame') || document.body;
    if (menu.parentNode !== host) host.appendChild(menu);

    const api = hasSelectionApi(f);
    saved = api ? { s: f.selectionStart, e: f.selectionEnd } : { s: null, e: null };
    const hasSelection = api ? saved.s !== saved.e : f.value !== '';   // no selection API: assume the browser's selection
    items[0].setAttribute('aria-disabled', String(f.type === 'password' || !hasSelection));
    items[1].setAttribute('aria-disabled', String(f.readOnly));
    note.hidden = true; note.textContent = '';
    menu.hidden = false;
    place(x, y);
    setActive(-1);
    if (fromKeyboard) move(1);
  }

  function place(x, y) {
    const vw = document.documentElement.clientWidth, vh = window.innerHeight, w = menu.offsetWidth, h = menu.offsetHeight;
    if (x + w > vw - 4) x = Math.max(4, x - w);
    if (y + h > vh - 4) y = Math.max(4, y - h);
    at = { x, y };
    menu.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)';
  }

  function close() {
    if (!isOpen()) return;
    menu.hidden = true;
    setActive(-1);
  }

  function hint(text) {
    // The browser's permission prompt can close the menu (the window loses focus): show it again with the note.
    note.textContent = text; note.hidden = false; menu.hidden = false;
    place(at.x, at.y);
  }

  function run(item) {
    if (!enabled(item)) return;
    if (item.dataset.act === 'copy') copy(); else paste();
  }

  /** Put the field's focus and selection back the way they were when the menu opened. */
  function restore(f) {
    if (document.activeElement !== f) f.focus({ preventScroll: true });
    if (hasSelectionApi(f) && saved.s !== null) {
      const len = f.value.length;
      f.setSelectionRange(Math.min(saved.s, len), Math.min(saved.e, len));
    }
  }

  async function copy() {
    const f = field;
    close();
    if (!f) return;
    if (!hasSelectionApi(f)) { restore(f); try { document.execCommand('copy'); } catch (_) { /* nothing more to try */ } return; }
    const text = f.value.slice(saved.s, saved.e);
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {                                    // no Clipboard API (plain http) or it was refused
      restore(f);
      try { document.execCommand('copy'); } catch (_) { /* nothing more to try */ }
    }
  }

  async function paste() {
    const f = field;
    let text;
    try {
      if (!navigator.clipboard || !navigator.clipboard.readText) throw new Error('no clipboard');
      text = await navigator.clipboard.readText();     // the browser may ask the person first
    } catch (err) {
      hint('The browser did not allow pasting from this menu. Press ' + MOD + 'V instead.');
      return;
    }
    close();
    if (!f || !text) return;
    restore(f);
    // insertText goes through the browser's own editing, so the field's listeners, maxlength and undo all
    // behave as for a typed paste. If it is not supported, set the text and fire the input event by hand.
    let done = false;
    try { done = document.execCommand('insertText', false, text); } catch (_) { done = false; }
    if (!done && hasSelectionApi(f)) {
      const len = f.value.length, s = Math.min(saved.s, len), e = Math.min(saved.e, len);
      const room = f.maxLength >= 0 ? Math.max(0, f.maxLength - (len - (e - s))) : text.length;
      f.setRangeText(text.slice(0, room), s, e, 'end');
      f.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste', data: text }));
    } else if (!done) {
      f.value = text;
      f.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste', data: text }));
    }
  }

  // ── events ──
  // No iOS long-press callouts outside text fields: see css/app.css.

  addEventListener('pointerdown', (e) => {
    lastPointer = { type: e.pointerType || 'mouse', at: Date.now() };
    if (isOpen() && !menu.contains(e.target)) close();
  }, true);

  addEventListener('contextmenu', (e) => {
    if (isOpen() && menu.contains(e.target)) { e.preventDefault(); return; }
    const f = textField(e.target);
    if (!f || f.disabled) { e.preventDefault(); close(); return; }

    const touch = e.pointerType === 'touch' || e.pointerType === 'pen' ||
      (lastPointer.type !== 'mouse' && Date.now() - lastPointer.at < 2000 && e.button !== 2);
    if (touch && touchOnly()) { close(); return; }          // phone / tablet: keep the system selection toolbar

    e.preventDefault();
    const fromKeyboard = !touch && e.button !== 2;
    const r = f.getBoundingClientRect();
    const inside = e.clientX > r.left && e.clientX < r.right && e.clientY > r.top && e.clientY < r.bottom;
    if (fromKeyboard || !inside) open(f, r.left + 12, Math.min(r.bottom - 4, r.top + 18), true);
    else open(f, e.clientX, e.clientY, false);
  }, true);

  // Keys go to the menu first while it is open, so they do not also reach the app (Escape, Enter in a form).
  addEventListener('keydown', (e) => {
    if (isDevShortcut(e)) { e.preventDefault(); e.stopPropagation(); return; }
    if (!isOpen()) return;
    const take = () => { e.preventDefault(); e.stopPropagation(); };
    switch (e.key) {
      case 'Escape': take(); close(); return;
      case 'ArrowDown': take(); move(1); return;
      case 'ArrowUp': take(); move(-1); return;
      case 'Home': take(); setActive(-1); move(1); return;
      case 'End': take(); setActive(-1); move(-1); return;
      case 'Enter': case ' ':
        if (active >= 0) { take(); run(items[active]); return; }
        close(); return;
      case 'Shift': case 'Control': case 'Alt': case 'Meta': case 'ContextMenu': case 'F10': return;
      default: close();                                    // any other key closes the menu and does its usual job
    }
  }, true);

  // Scrolling the page, a column that holds the field, or the field itself moves the text away from the menu.
  addEventListener('scroll', (e) => {
    if (isOpen() && field && (e.target === document || (e.target instanceof Node && e.target.contains(field)))) close();
  }, true);
  addEventListener('input', (e) => { if (e.target === field) close(); }, true);
  addEventListener('resize', close);
  addEventListener('blur', close);
  window.addEventListener('hashchange', close);
  // Dragging text or images out of the app is not needed either (text fields still allow it).
  addEventListener('dragstart', (e) => { if (!textField(e.target)) e.preventDefault(); }, true);
})();
