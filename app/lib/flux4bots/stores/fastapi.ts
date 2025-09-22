import type { DocumentStore, Operation } from '../types';

type Opts = { baseUrl: string; objectId: string };

export class FastApiDocumentStore implements DocumentStore {
  constructor(private opts: Opts) {}

  async getDoc() {
    const r = await fetch(`${this.opts.baseUrl}/objects/${this.opts.objectId}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    const json = await r.json();
    return json.doc;
  }

  async applyPatch(ops: Operation[]) {
    const r = await fetch(`${this.opts.baseUrl}/objects/${this.opts.objectId}/applyPatch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patch: ops })
    });
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    const json = await r.json();
    return json.doc;
  }
}
