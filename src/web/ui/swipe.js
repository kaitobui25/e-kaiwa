// A swipe is recognized only after pointerup; pointerdown is never consumed.
// Interactive children (especially the Hold-to-Talk button) keep their own pointer lifecycle.
export function installHorizontalSwipe(element, onSwipe, {minDistance = 60, maxVerticalRatio = 0.65} = {}) {
  if (!element?.addEventListener) return () => {};
  let pointer = null;
  const interactive = target => Boolean(target?.closest?.('button, a, input, select, textarea, [role="button"]'));

  const down = event => {
    if (event.isPrimary === false || (event.pointerType === 'mouse' && event.button !== 0) || interactive(event.target)) {
      pointer = null;
      return;
    }
    pointer = {id: event.pointerId, x: event.clientX, y: event.clientY};
  };
  const up = event => {
    if (!pointer || event.pointerId !== pointer.id) return;
    const dx = event.clientX - pointer.x;
    const dy = event.clientY - pointer.y;
    pointer = null;
    if (Math.abs(dx) < minDistance || Math.abs(dy) > Math.abs(dx) * maxVerticalRatio) return;
    onSwipe(dx < 0 ? 'left' : 'right');
  };
  const cancel = event => {
    if (!pointer || event.pointerId === pointer.id) pointer = null;
  };
  element.addEventListener('pointerdown', down);
  element.addEventListener('pointerup', up);
  element.addEventListener('pointercancel', cancel);
  element.addEventListener('lostpointercapture', cancel);
  return () => {
    element.removeEventListener('pointerdown', down);
    element.removeEventListener('pointerup', up);
    element.removeEventListener('pointercancel', cancel);
    element.removeEventListener('lostpointercapture', cancel);
  };
}
