import type { Pointer } from '../types';

export function decodePointerSegment(seg: string) {
  return seg.replace(/~1/g, '/').replace(/~0/g, '~');
}
export function encodePointerSegment(seg: string) {
  return seg.replace(/~/g, '~0').replace(/\//g, '~1');
}

export function getAtPointer(obj: any, pointer: Pointer) {
  if (pointer === '' || pointer === '/') return obj;
  const parts = pointer.split('/').slice(1).map(decodePointerSegment);
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

export function setAtPointer(obj: any, pointer: Pointer, value: any) {
  const parts = pointer.split('/').slice(1).map(decodePointerSegment);
  const last = parts.pop();
  if (!last) return;
  let cur = obj;
  for (const p of parts) {
    if (typeof cur[p] !== 'object' || cur[p] === null) cur[p] = {};
    cur = cur[p];
  }
  cur[last] = value;
}

export function joinPointer(base: Pointer, tail: Pointer): Pointer {
  if (tail === '' || tail === '/') return base;
  if (!tail.startsWith('/')) throw new Error(`tail must start with '/': ${tail}`);
  return `${base}${tail}`;
}
