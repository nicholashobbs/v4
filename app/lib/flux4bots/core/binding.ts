import { getAtPointer } from './pointer';
import type { Binding, Pointer } from '../types';

// Expand ${/pointer} segments inside a binding path using values from doc.
// If any segment fails to resolve to a string pointer, returns null.
export function resolveBindingPath(binding: Binding | undefined, doc: any): Pointer | null {
  if (!binding) return null;
  const path = binding.path;
  if (!path.includes('${')) return path;
  const replaced = path.replace(/\$\{([^}]+)\}/g, (_m, inner: string) => {
    const v = getAtPointer(doc, inner);
    if (typeof v !== 'string' || !v.startsWith('/')) return '';
    return v;
  });
  return replaced || null;
}
