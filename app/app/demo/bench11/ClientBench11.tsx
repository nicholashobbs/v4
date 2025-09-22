'use client';

import { useMemo, useState } from 'react';
import { Flux4Bots, FastApiDocumentStore, type Template } from '../../../lib/flux4bots';

const BASE = process.env.NEXT_PUBLIC_SERVER_BASE_URL ?? 'http://localhost:8000';

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    cache: 'no-store'
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

export default function ClientBench11({ template }: { template: Template }) {
  const [objId, setObjId] = useState<string | null>(null);
  const store = useMemo(
    () => (objId ? new FastApiDocumentStore({ baseUrl: BASE, objectId: objId }) : null),
    [objId]
  );

  async function handleSeed() {
    const createdObj = await api<{ id: string }>('/objects', {
      method: 'POST',
      body: JSON.stringify({
        doc: {
          projects: [
            { id: 1, name: 'Project A', status: 'In Progress' },
            { id: 2, name: 'Project B', status: 'Not Started' }
          ]
        }
      })
    });
    setObjId(createdObj.id);
  }

  return (
    <main style={{ maxWidth: 960 }}>
      <h1>Benchmark 11 — Flux4Bots (Bench 6 via package)</h1>

      <details open style={{ margin: '12px 0 20px' }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Controls</summary>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={handleSeed} style={{ padding: '8px 12px' }}>Seed Object</button>
          <div style={{ opacity: 0.8 }}>objId: {objId ?? '—'}</div>
          <div style={{ opacity: 0.8 }}>template: app/app/demo/bench11/template.yaml</div>
        </div>
      </details>

      {!store && <p style={{ opacity: 0.8 }}>Click <b>Seed Object</b> to create a document.</p>}

      {store && (
        <Flux4Bots
          template={template}
          store={store}
          mode="diff"
          ui={{ showPatchPreview: true, showApplyButton: true, showCurrentJson: true }}
        />
      )}
    </main>
  );
}
