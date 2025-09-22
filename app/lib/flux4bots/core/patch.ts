import * as jsonpatch from 'fast-json-patch';
import type { Operation } from '../types';

// Diff two docs and return our Operation[]
export function compareDocsToPatch(a: any, b: any): Operation[] {
  const raw = jsonpatch.compare(a, b) as Array<{ op: string; path: string; value?: any }>;
  return raw
    .filter(o => o.op === 'add' || o.op === 'replace' || o.op === 'remove')
    .map(o => {
      if (o.op === 'remove') {
        return { op: 'remove', path: o.path } as Operation;
      }
      return { op: o.op as 'add' | 'replace', path: o.path, value: (o as any).value } as Operation;
    });
}

// Apply our Operation[] using fast-json-patch under the hood
export function applyPatch(doc: any, ops: Operation[]): any {
  const cloned = JSON.parse(JSON.stringify(doc));
  return jsonpatch.applyPatch(cloned, ops as any).newDocument;
}
