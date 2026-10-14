import { InvalidResponse } from './validation.ts';

export const MAX_RESPONSE_BYTES = 1_048_576;

export function endpoint(baseUrl: string, path: string): string {
  return new URL(`${baseUrl.replace(/\/+$/u, '')}${path}`).toString();
}

export async function requestText(
  url: string, options: RequestInit, signal: AbortSignal,
  format: 'json' | 'xml', readStatuses: readonly number[],
): Promise<{ readonly status: number; readonly body: string }> {
  const response = await fetch(url, { ...options, signal, redirect: 'error' });
  if (!readStatuses.includes(response.status)) {
    await response.body?.cancel();
    return { status: response.status, body: '' };
  }
  const type = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  const correctType = format === 'json'
    ? type === 'application/json' || /^application\/[\w.+-]+\+json$/u.test(type ?? '')
    : type === 'text/xml' || type === 'application/xml' || /^application\/[\w.+-]+\+xml$/u.test(type ?? '');
  const length = response.headers.get('content-length');
  if (!correctType || (length !== null && (!/^\d+$/u.test(length) || Number(length) > MAX_RESPONSE_BYTES))) {
    await response.body?.cancel();
    throw new InvalidResponse();
  }
  if (!response.body) throw new InvalidResponse();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new InvalidResponse();
      chunks.push(chunk.value);
    }
    const bytes = Buffer.concat(chunks, size);
    return { status: response.status, body: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (error instanceof TypeError && !signal.aborted) throw new InvalidResponse();
    throw error;
  } finally { reader.releaseLock(); }
}
