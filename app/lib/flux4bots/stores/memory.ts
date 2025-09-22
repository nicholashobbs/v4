import type { DocumentStore, Operation } from '../types';
import { applyPatch } from '../core/patch';

export class MemoryDocumentStore implements DocumentStore {
  private doc: any;
  constructor(seed: any) { this.doc = seed; }
  async getDoc() { return JSON.parse(JSON.stringify(this.doc)); }
  async applyPatch(ops: Operation[]) {
    this.doc = applyPatch(this.doc, ops);
    return JSON.parse(JSON.stringify(this.doc));
  }
}
