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

/* ---------- Demo YAML (Benchmark 9) ---------- */
const DEMO_YAML = `
version: 1
name: "Rename key (add+remove)"
widgets:
  - id: picker
    type: field-picker
    label: "Pick a key under /profile"
    options: { basePath: "/profile", selection: "single" }
  - id: newKey
    type: text
    label: "New key name"
  - id: rename
    type: action
    label: "Rename Key"
    options: { action: "rename-key" }
layout:
  type: vertical
  children: [picker, newKey, rename]
`.trim();

/* ---------- Types (just what we use on this page) ---------- */
type FieldPickerWidget = {
  id: string;
  type: 'field-picker';
  label: string;
  options: { basePath: string; selection: 'single' | 'multiple' };
};
type TextWidget = { id: string; type: 'text'; label: string };
type ActionWidget = { id: string; type: 'action'; label: string; options?: { action?: string } };
type Widget = FieldPickerWidget | TextWidget | ActionWidget;
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

export default function Bench9Page() {
  const [yamlText, setYamlText] = useState(DEMO_YAML);
  const [tplId, setTplId] = useState<string | null>(null);
  const [objId, setObjId] = useState<string | null>(null);

  const [originalDoc, setOriginalDoc] = useState<any | null>(null);

  // explicit ops & preview (like bench7/8)
  const [pendingOps, setPendingOps] = useState<Operation[]>([]);
  const [workingPreview, setWorkingPreview] = useState<any | null>(null);

  // local UI state
  const [selectedKey, setSelectedKey] = useState<string>('');
  const [newKey, setNewKey] = useState<string>('');

  const tpl: Template | null = useMemo(() => {
    try { return YAML.load(yamlText) as Template; } catch { return null; }
  }, [yamlText]);

  async function handleSeed() {
    const createdTpl = await api<{ id: string; yaml: string }>('/templates', {
      method: 'POST',
      body: JSON.stringify({ yaml: yamlText, name: 'Bench9' }),
    });
    setTplId(createdTpl.id);

    // Seed profile with two keys; we’ll rename "nickname" to something else
    const createdObj = await api<{ id: string }>('/objects', {
      method: 'POST',
      body: JSON.stringify({
        doc: {
          profile: { nickname: 'Nick', email: 'nick@example.com' }
        }
      }),
    });
    setObjId(createdObj.id);

    const got = await api<{ id: string; doc: any }>(`/objects/${createdObj.id}`);
    setOriginalDoc(got.doc);
    setWorkingPreview(got.doc);
    setPendingOps([]);
    setSelectedKey('');
    setNewKey('');
  }

  function queueRename(basePath: string) {
    if (!originalDoc) return;
    const oldKey = selectedKey.trim();
    const nextKey = newKey.trim();
    if (!oldKey || !nextKey) return;
    if (oldKey === nextKey) return; // no-op

    const oldPath = `${basePath}/${encodePointerSegment(oldKey)}`;
    const newPath = `${basePath}/${encodePointerSegment(nextKey)}`;

    const value = getAtPointer(originalDoc, oldPath);
    if (typeof value === 'undefined') return; // key no longer exists

    const ops: Operation[] = [
      { op: 'add', path: newPath, value },   // add/replace new key
      { op: 'remove', path: oldPath }        // remove old key
    ];

    const applied = jsonpatch.applyPatch(originalDoc, ops, /*validate*/ false).newDocument;
    setPendingOps(ops);
    setWorkingPreview(applied);
  }

  async function applyPatch() {
    if (!objId || pendingOps.length === 0) return;

    const updated = await api<{ id: string; doc: any }>(
      `/objects/${objId}/applyPatch`,
      { method: 'POST', body: JSON.stringify({ patch: pendingOps }) }
    );

    setOriginalDoc(updated.doc);
    setWorkingPreview(updated.doc);
    setPendingOps([]);
    // keep inputs or clear them as you prefer
  }

  /* ---------- renderers ---------- */
  function renderPicker(w: FieldPickerWidget) {
    if (!workingPreview) return null;
    const basePath = w.options.basePath;
    const obj = getAtPointer(workingPreview, basePath);
    const keys = (obj && typeof obj === 'object') ? Object.keys(obj) : [];

    return (
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: 'block', fontWeight: 600, marginBottom: 6 }}>{w.label}</label>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {keys.map(k => (
            <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="radio"
                name="renameKeyPicker"
                checked={selectedKey === k}
                onChange={() => setSelectedKey(k)}
              />
              {k} <span style={{ opacity: 0.6, fontSize: 12 }}>({basePath}/{encodePointerSegment(k)})</span>
            </label>
          ))}
          {keys.length === 0 && <span style={{ opacity: 0.7 }}>No keys under {basePath}</span>}
        </div>
        <div style={{ marginTop: 6, fontSize: 12, opacity: 0.7 }}>
          Selected: {selectedKey || '—'}
        </div>
      </div>
    );
  }

  function renderText(w: TextWidget) {
    return (
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>{w.label}</label>
        <input
          value={newKey}
          onChange={e => setNewKey(e.target.value)}
          style={{ padding: 8, width: 340 }}
          placeholder="alias"
        />
      </div>
    );
  }

  function renderAction(w: ActionWidget) {
    const basePath = '/profile'; // from YAML for this page
    return (
      <div style={{ marginBottom: 12 }}>
        <button
          onClick={() => queueRename(basePath)}
          disabled={!selectedKey || !newKey}
          style={{ padding: '8px 12px' }}
          title="Compose add+remove ops to rename a key"
        >
          {w.label}
        </button>
        <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>
          Action: {w.options?.action ?? '—'}
        </div>
      </div>
    );
  }

  function renderWidgetById(id: string) {
    if (!tpl) return null;
    const w = tpl.widgets.find(x => x.id === id);
    if (!w) return <div key={id} style={{ color: 'crimson' }}>Missing widget: {id}</div>;

    if (w.type === 'field-picker') return <div key={id}>{renderPicker(w)}</div>;
    if (w.type === 'text')         return <div key={id}>{renderText(w)}</div>;
    if (w.type === 'action')       return <div key={id}>{renderAction(w)}</div>;
    return <div key={id} style={{ color: 'crimson' }}>Unsupported widget type</div>;
  }

  const canRender = Boolean(tpl && tpl.layout?.type === 'vertical' && originalDoc && workingPreview);

  return (
    <main style={{ maxWidth: 900 }}>
      <h1>Benchmark 9 — Rename key via add+remove</h1>

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
              <h4 style={{ margin: '8px 0' }}>Patch Preview (explicit ops)</h4>
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
