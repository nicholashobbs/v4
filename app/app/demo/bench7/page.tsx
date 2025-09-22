'use client';

import { useMemo, useState } from 'react';
import * as YAML from 'js-yaml';
import * as jsonpatch from 'fast-json-patch';
import type { Operation } from 'fast-json-patch';

const BASE = process.env.NEXT_PUBLIC_SERVER_BASE_URL ?? 'http://localhost:8000';

/* ---------- JSON Pointer helpers ---------- */
function decodePointerSegment(seg: string) {
  return seg.replace(/~1/g, '/').replace(/~0/g, '~');
}
function encodePointerSegment(seg: string) {
  return seg.replace(/~/g, '~0').replace(/\//g, '~1');
}
function getAtPointer(obj: any, pointer: string) {
  if (pointer === '' || pointer === '/') return obj;
  const parts = pointer.split('/').slice(1).map(decodePointerSegment);
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

/* ---------- Demo YAML (Benchmark 7) ---------- */
const DEMO_YAML = `
version: 1
name: "Create social link (action)"
widgets:
  - id: platform
    type: select
    label: "Platform"
    options: { values: ["Twitter","LinkedIn","GitHub"] }
  - id: url
    type: text
    label: "URL"
  - id: create
    type: action
    label: "Create Link"
    options: { action: "create-social-link" }
layout:
  type: vertical
  children: [platform, url, create]
`.trim();

/* ---------- Types (just what we use on this page) ---------- */
type SelectWidget = {
  id: string; type: 'select'; label: string; options?: { values?: string[] };
};
type TextWidget = {
  id: string; type: 'text'; label: string;
};
type ActionWidget = {
  id: string; type: 'action'; label: string; options?: { action?: string };
};
type Widget = SelectWidget | TextWidget | ActionWidget;
type Template = {
  version: number; name: string;
  widgets: Widget[];
  layout: { type: 'vertical'; children: string[] };
};

/* ---------- API helper ---------- */
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

export default function Bench7Page() {
  const [yamlText, setYamlText] = useState(DEMO_YAML);
  const [tplId, setTplId] = useState<string | null>(null);
  const [objId, setObjId] = useState<string | null>(null);

  const [originalDoc, setOriginalDoc] = useState<any | null>(null);

  // In this benchmark, we preview "pendingOps" explicitly when you click the Action button.
  const [pendingOps, setPendingOps] = useState<Operation[]>([]);
  const [workingPreview, setWorkingPreview] = useState<any | null>(null);

  // Local UI state (not bound into JSON)
  const [platform, setPlatform] = useState<string>('');
  const [url, setUrl] = useState<string>('');

  const tpl: Template | null = useMemo(() => {
    try { return YAML.load(yamlText) as Template; } catch { return null; }
  }, [yamlText]);

  async function handleSeed() {
    const createdTpl = await api<{ id: string; yaml: string }>('/templates', {
      method: 'POST',
      body: JSON.stringify({ yaml: yamlText, name: 'Bench7' }),
    });
    setTplId(createdTpl.id);

    // Start with empty social_links
    const createdObj = await api<{ id: string }>('/objects', {
      method: 'POST',
      body: JSON.stringify({ doc: { social_links: {} } }),
    });
    setObjId(createdObj.id);

    const got = await api<{ id: string; doc: any }>(`/objects/${createdObj.id}`);
    setOriginalDoc(got.doc);
    setWorkingPreview(got.doc);
    setPendingOps([]);
    setPlatform('');
    setUrl('');
  }

  function queueCreateLink() {
    if (!originalDoc) return;
    if (!platform || !url) return;

    // Compose a single explicit op using the chosen platform as the key.
    const path = `/social_links/${encodePointerSegment(platform)}`;
    const op: Operation = { op: 'add', path, value: url };

    // Update pending ops and local preview doc
    const nextOps = [op];
    const applied = jsonpatch.applyPatch(originalDoc, nextOps, /*validate*/ false).newDocument;
    setPendingOps(nextOps);
    setWorkingPreview(applied);
  }

  async function applyPatch() {
    if (!objId || pendingOps.length === 0) return;

    // Send ONLY the explicit ops
    const updated = await api<{ id: string; doc: any }>(
      `/objects/${objId}/applyPatch`,
      { method: 'POST', body: JSON.stringify({ patch: pendingOps }) }
    );

    // Reset state to reflect the server doc
    setOriginalDoc(updated.doc);
    setWorkingPreview(updated.doc);
    setPendingOps([]);
    // keep user inputs; or clear them:
    // setPlatform(''); setUrl('');
  }

  function renderWidgetById(id: string) {
    if (!tpl) return null;
    const w = tpl.widgets.find(x => x.id === id);
    if (!w) return <div key={id} style={{ color: 'crimson' }}>Missing widget: {id}</div>;

    if (w.type === 'select') {
      const opts = w.options?.values ?? [];
      return (
        <div key={id} style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>{w.label}</label>
          <select
            value={platform}
            onChange={e => setPlatform(e.target.value)}
            style={{ padding: 8, width: 360 }}
          >
            <option value="" disabled>— select —</option>
            {opts.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
      );
    }

    if (w.type === 'text') {
      return (
        <div key={id} style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>{w.label}</label>
          <input
            value={url}
            onChange={e => setUrl(e.target.value)}
            style={{ padding: 8, width: 480 }}
            placeholder="https://example.com/you"
          />
        </div>
      );
    }

    if (w.type === 'action') {
      return (
        <div key={id} style={{ marginBottom: 12 }}>
          <button
            onClick={queueCreateLink}
            disabled={!platform || !url}
            style={{ padding: '8px 12px' }}
            title="Compose an add op using the selected platform as the key"
          >
            {w.label}
          </button>
          <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>
            Action: {w.options?.action ?? '—'}
          </div>
        </div>
      );
    }

    return <div key={id} style={{ color: 'crimson' }}>Unsupported widget type</div>;
  }

  const canRender = Boolean(tpl && tpl.layout?.type === 'vertical' && originalDoc && workingPreview);

  return (
    <main style={{ maxWidth: 900 }}>
      <h1>Benchmark 7 — Dynamic field creation from choice</h1>

      <details open style={{ margin: '12px 0 20px' }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>YAML Template</summary>
        <textarea
          value={yamlText}
          onChange={(e) => setYamlText(e.target.value)}
          style={{ width: '100%', height: 240, fontFamily: 'monospace', fontSize: 14 }}
        />
        <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
          <button onClick={handleSeed} style={{ padding: '8px 12px' }}>Seed Template + Object</button>
          <div style={{ opacity: 0.8 }}>
            tplId: {tplId ?? '—'} &nbsp; objId: {objId ?? '—'}
          </div>
        </div>
      </details>

      {!canRender && (
        <p style={{ opacity: 0.8 }}>
          Click <b>Seed Template + Object</b> to create a doc and render the form.
        </p>
      )}

      {canRender && tpl ? (
        <>
          <section style={{ padding: 12, border: '1px solid #ddd', borderRadius: 8, marginBottom: 16 }}>
            <h3 style={{ marginTop: 0 }}>{tpl.name}</h3>
            {tpl.layout.children.map((childId) => (
              <div key={childId}>{renderWidgetById(childId)}</div>
            ))}
          </section>

          <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <h4 style={{ margin: '8px 0' }}>Patch Preview</h4>
              <pre style={{ background: '#f7f7f7', padding: 12, borderRadius: 8, maxHeight: 280, overflow: 'auto' }}>
                {JSON.stringify(pendingOps, null, 2)}
              </pre>
              <button onClick={applyPatch} disabled={pendingOps.length === 0} style={{ padding: '8px 12px' }}>
                Apply Patch
              </button>
            </div>
            <div>
              <h4 style={{ margin: '8px 0' }}>Current JSON (preview)</h4>
              <pre style={{ background: '#f7f7f7', padding: 12, borderRadius: 8, maxHeight: 280, overflow: 'auto' }}>
                {JSON.stringify(workingPreview, null, 2)}
              </pre>
            </div>
          </section>
        </>
      ) : null}
    </main>
  );
}
