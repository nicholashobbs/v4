'use client';

import { useMemo, useState } from 'react';
import {
  Flux4Bots,
  FastApiDocumentStore,
  type Template,
  type ActionRegistry,
} from '../../../lib/flux4bots';

const BASE = process.env.NEXT_PUBLIC_SERVER_BASE_URL ?? 'http://localhost:8000';

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

export default function ClientBench13({ template }: { template: Template }) {
  const [objId, setObjId] = useState<string | null>(null);

  const store = useMemo(() => {
    return objId ? new FastApiDocumentStore({ baseUrl: BASE, objectId: objId }) : null;
  }, [objId]);

  async function handleSeed() {
    // Seed with a simple, flat /meta for easy rename/delete
    const createdObj = await api<{ id: string }>('/objects', {
      method: 'POST',
      body: JSON.stringify({
        doc: {
          profile: { name: { first: 'Ada', last: 'Lovelace' } },
          meta: {
            draft: true,
            deprecated: false,
            internal_note: 'initial',
          },
        },
      }),
    });
    setObjId(createdObj.id);
  }

  const actions: ActionRegistry = {
    // Rename /meta/<oldKey> -> /meta/<newKey>
    'rename-meta-key': (ctx) => {
      const oldKey = String(ctx.vars.oldKey ?? '').trim();
      const newKey = String(ctx.vars.newKey ?? '').trim();
      if (!oldKey || !newKey || oldKey === newKey) return [];

      const oldPath = `/meta/${ctx.helpers.encode(oldKey)}`;
      const newPath = `/meta/${ctx.helpers.encode(newKey)}`;
      const val = ctx.helpers.get(ctx.working ?? ctx.doc, oldPath);

      // If the old key doesn't exist, do nothing (avoid invalid remove)
      if (typeof val === 'undefined') return [];

      // JSON Patch rename = add new with value, then remove old
      return [
        { op: 'add', path: newPath, value: val },
        { op: 'remove', path: oldPath },
      ];
    },

    // Delete /meta/<k> for each k in comma-separated input
    'delete-meta-keys': (ctx) => {
      const csv = String((ctx.vars as any).keysCsv ?? '').trim();
      if (!csv) return [];
      const keys = csv.split(',').map(s => s.trim()).filter(Boolean);

      const ops = [];
      for (const k of keys) {
        const p = `/meta/${ctx.helpers.encode(k)}`;
        const exists = typeof ctx.helpers.get(ctx.working ?? ctx.doc, p) !== 'undefined';
        if (exists) ops.push({ op: 'remove', path: p } as const);
      }
      return ops as any;
    },
  };

  return (
    <main style={{ maxWidth: 960 }}>
      <h1>Benchmark 13 — Rename & Delete (explicit multi-op)</h1>

      <details open style={{ margin: '12px 0 20px' }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Controls</summary>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={handleSeed} style={{ padding: '8px 12px' }}>Seed Object</button>
          <div style={{ opacity: 0.8 }}>objId: {objId ?? '—'}</div>
        </div>
      </details>

      {!store && <p style={{ opacity: 0.8 }}>Click <b>Seed Object</b> to create a document.</p>}

      {store && (
        <Flux4Bots
          template={template}
          store={store}
          mode="explicit"
          actions={actions}
          ui={{ showPatchPreview: true, showApplyButton: true, showCurrentJson: true }}
        />
      )}
    </main>
  );
}
