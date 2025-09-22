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
function setAtPointer(obj: any, pointer: string, value: any) {
  const parts = pointer.split('/').slice(1).map(decodePointerSegment);
  const last = parts.pop();
  if (!last) return;
  let cur = obj;
  for (const p of parts) {
    if (typeof cur[p] !== 'object' || cur[p] === null) cur[p] = {};
    cur = cur[p];
  }
  cur[last] = value;
}

/* ---------- Demo YAML (Benchmark 8) ---------- */
const DEMO_YAML = `
version: 1
name: "Batch delete from /meta"
widgets:
  - id: picker
    type: field-picker
    label: "Choose keys under /meta to delete"
    options: { basePath: "/meta", selection: "multiple" }
    binding: { path: "/_pending/delete" }
  - id: delete
    type: action
    label: "Delete Selected"
    options: { action: "batch-remove" }
layout:
  type: vertical
  children: [picker, delete]
`.trim();

/* ---------- Types (for this page) ---------- */
type FieldPickerWidget = {
  id: string;
  type: 'field-picker';
  label: string;
  binding: { path: string }; // we write selected keys array to here
  options: { basePath: string; selection: 'single' | 'multiple' };
};
type ActionWidget = {
  id: string;
  type: 'action';
  label: string;
  options?: { action?: string };
};
type Widget = FieldPickerWidget | ActionWidget;
type Template = {
  version: number;
  name: string;
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

export default function Bench8Page() {
  const [yamlText, setYamlText] = useState(DEMO_YAML);
  const [tplId, setTplId] = useState<string | null>(null);
  const [objId, setObjId] = useState<string | null>(null);

  const [originalDoc, setOriginalDoc] = useState<any | null>(null);

  // For this benchmark, we explicitly manage ops preview (like bench7)
  const [pendingOps, setPendingOps] = useState<Operation[]>([]);
  const [workingPreview, setWorkingPreview] = useState<any | null>(null);

  // Local selection state mirrors /_pending/delete (array of keys)
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);

  const tpl: Template | null = useMemo(() => {
    try { return YAML.load(yamlText) as Template; } catch { return null; }
  }, [yamlText]);

  async function handleSeed() {
    const createdTpl = await api<{ id: string; yaml: string }>('/templates', {
      method: 'POST',
      body: JSON.stringify({ yaml: yamlText, name: 'Bench8' }),
    });
    setTplId(createdTpl.id);

    const createdObj = await api<{ id: string }>('/objects', {
      method: 'POST',
      body: JSON.stringify({
        doc: {
          meta: { temp: ['x'], draft: true, notes: 'keep' },
          _pending: { delete: [] }
        }
      }),
    });
    setObjId(createdObj.id);

    const got = await api<{ id: string; doc: any }>(`/objects/${createdObj.id}`);
    setOriginalDoc(got.doc);
    setWorkingPreview(got.doc);
    setPendingOps([]);
    setSelectedKeys([]);
  }

  function toggleKey(basePath: string, key: string, checked: boolean) {
    const nextKeys = checked
      ? Array.from(new Set([...selectedKeys, key]))
      : selectedKeys.filter(k => k !== key);

    setSelectedKeys(nextKeys);

    // reflect this selection into workingPreview at binding path "/_pending/delete"
    if (workingPreview) {
      const next = JSON.parse(JSON.stringify(workingPreview));
      setAtPointer(next, '/_pending/delete', nextKeys);
      setWorkingPreview(next);
    }
  }

  function queueDeleteSelected(basePath: string) {
    if (!originalDoc) return;
    if (selectedKeys.length === 0) return;

    // Compose explicit remove ops for keys that actually exist now.
    const baseObj = getAtPointer(originalDoc, basePath);
    const keysToRemove = selectedKeys.filter(k => baseObj && Object.prototype.hasOwnProperty.call(baseObj, k));

    const ops: Operation[] = keysToRemove.map(k => ({
      op: 'remove',
      path: `${basePath}/${encodePointerSegment(k)}`
    }));

    // Preview the result
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
    // Keep selectedKeys as-is (or clear them if you prefer):
    // setSelectedKeys([]);
  }

  function renderFieldPicker(w: FieldPickerWidget) {
    if (!workingPreview) return null;
    const basePath = w.options.basePath;
    const baseObj = getAtPointer(workingPreview, basePath);
    const keys = (baseObj && typeof baseObj === 'object') ? Object.keys(baseObj) : [];

    return (
      <div key={w.id} style={{ marginBottom: 12 }}>
        <label style={{ display: 'block', fontWeight: 600, marginBottom: 6 }}>{w.label}</label>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {keys.map(k => {
            const checked = selectedKeys.includes(k);
            return (
              <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={e => toggleKey(basePath, k, e.target.checked)}
                />
                {k} <span style={{ opacity: 0.6, fontSize: 12 }}>({basePath}/{encodePointerSegment(k)})</span>
              </label>
            );
          })}
          {keys.length === 0 && <span style={{ opacity: 0.7 }}>No keys under {basePath}</span>}
        </div>
        <div style={{ marginTop: 6, fontSize: 12, opacity: 0.7 }}>
          Selected keys → <code>/_pending/delete</code>: [{selectedKeys.join(', ')}]
        </div>
      </div>
    );
  }

  function renderAction(w: ActionWidget) {
    // find the field-picker to read its basePath (simple: we know it in YAML)
    const basePath = '/meta';
    return (
      <div key={w.id} style={{ marginBottom: 12 }}>
        <button
          onClick={() => queueDeleteSelected(basePath)}
          disabled={selectedKeys.length === 0}
          style={{ padding: '8px 12px' }}
          title="Compose remove ops for selected keys"
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

    if (w.type === 'field-picker') return renderFieldPicker(w);
    if (w.type === 'action') return renderAction(w);
    return <div key={id} style={{ color: 'crimson' }}>Unsupported widget type</div>;
  }

  const canRender = Boolean(tpl && tpl.layout?.type === 'vertical' && originalDoc && workingPreview);

  return (
    <main style={{ maxWidth: 900 }}>
      <h1>Benchmark 8 — Batch delete via picker (multi-select)</h1>

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
