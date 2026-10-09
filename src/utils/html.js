export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

export function localUrlPath(value) {
  const segments = String(value).replace(/\\/g, '/').split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..') ||
      /^[a-z][a-z\d+.-]*:/i.test(value)) {
    throw new Error('Invalid local resource path');
  }
  return segments.map(segment => encodeURIComponent(segment)).join('/');
}
