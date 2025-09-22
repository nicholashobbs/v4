import * as jsonpatch from 'fast-json-patch';
import type { Operation } from '../types';

export function compareDocsToPatch(original: any, working: any): Operation[] {
  const full = jsonpatch.compare(original, working) as Operation[];
  // Keep to add/replace/remove for simplicity
  return full.filter(op => op.op === 'add' || op.op === 'replace' || op.op === 'remove');
}

export function applyPatch(doc: any, ops: Operation[]): any {
  const res = jsonpatch.applyPatch(doc, ops as any, false);
  return res.newDocument;
}
