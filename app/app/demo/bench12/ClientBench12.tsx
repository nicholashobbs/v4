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

export default function ClientBench12({ template }: { template: Template }) {
  const [objId, setObjId] = useState<string | null>(null);

  const store = useMemo(() => {
    return objId ? new FastApiDocumentStore({ baseUrl: BASE, objectId: objId }) : null;
  }, [objId]);

  async function handleSeed() {
    const createdObj = await api<{ id: string }>('/objects', {
      method: 'POST',
      body: JSON.stringify({ doc: { social_links: {} } }),
    });
    setObjId(createdObj.id);
  }

  // ✅ Single, typed action registry
  const actions: ActionRegistry = {
    'create-social-link': (ctx) => {
      const platform = String(ctx.vars.platform ?? '').trim();
      const url = String(ctx.vars.url ?? '').trim();
      if (!platform || !url) return [];
      return [
        { op: 'add', path: `/social_links/${ctx.helpers.encode(platform)}`, value: url },
      ];
    },
  };

  return (
    <main style={{ maxWidth: 960 }}>
      <h1>Benchmark 12 — Dynamic Field Creation (explicit)</h1>

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
