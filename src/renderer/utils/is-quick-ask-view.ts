/** True when this renderer instance is the Quick Ask floating window. */
export function isQuickAskView(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('view') === 'quick-ask') {
      return true;
    }
    return window.location.hash === '#quick-ask';
  } catch {
    return false;
  }
}
