export function maskDocument(document: string): string {
  const visible = Math.min(4, Math.max(0, document.length - 1));
  return '*'.repeat(document.length - visible || 1) + (visible ? document.slice(-visible) : '');
}
