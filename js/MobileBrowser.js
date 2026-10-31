/** Keep menu taps/scrolling native while held flight controls own their gestures. */
export function installMobileBrowserGuards(doc = document) {
  const preventIn = selector => event => {
    const target = event.target?.closest ? event.target : event.target?.parentElement;
    if (target?.closest?.(selector) && !target.closest('input, select, textarea, [contenteditable]:not([contenteditable="false"])') && event.cancelable !== false) event.preventDefault();
  };
  const guard = preventIn('#hud, #scene');
  for (const type of ['dblclick', 'gesturestart', 'gesturechange']) doc.addEventListener(type, guard, { passive: false });
  // Pointer capture alone does not suppress Android context menus or Safari callouts.
  const controls = preventIn('#scene, .touch-controls');
  for (const type of ['contextmenu', 'selectstart', 'dragstart']) doc.addEventListener(type, controls, { passive: false });
  // Cancel Touch Events only for continuous controls. Bomb/evade/target buttons
  // need their native click, and the briefing/settings must remain scrollable.
  const held = preventIn('#touch-fire, #flight-joystick, #touch-look, .touch-controls [data-key]');
  for (const type of ['touchstart', 'touchmove']) doc.addEventListener(type, held, { passive: false });
}
