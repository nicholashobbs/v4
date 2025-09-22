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
function joinPointer(base: string, tail: string) {
  // base: "/tags/0", tail: "/key" -> "/tags/0/key"
  if (tail === '' || tail === '/') return base;
  if (!tail.startsWith('/')) throw new Error(`tail must start with '/': ${tail}`);
  return `${base}${tail}`;
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

/* ---------- Demo YAML (Benchmark 4) ---------- */
const DEMO_YAML = `
version: 1
name: "Tags (list of objects)"
widgets:
  - id: tags
    type: list
    label: "Tags"
    binding: { path: "/tags" }
    item:
      fields:
        - id: key
          type: text
          label: "Key"
          binding: { path: "/key" }
        - id: value
          type: text
          label: "Value"
          binding: { path: "/value" }
layout:
  type: vertical
  children: [tags]
`.trim();

/* ---------- Types ---------- */
type TextField = { id: string; type: 'text'; label: string; binding: { path: string } };
type ListItemSpec = { fields: TextField[] };
type ListWidget = {
  id: string;
  type: 'list';
  label: string;
  binding: { path: string };
  item: ListItemSpec;
};
type Widget = ListWidget; // for this page we only support `list`
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

/* ---------- Component ---------- */
export default function Bench4Page() {
  const [yamlText, setYamlText] = useState(DEMO_YAML);
  const [tplId, setTplId] = useState<string | null>(null);
  const [objId, setObjId] = useState<string | null>(null);

  const [originalDoc, setOriginalDoc] = useState<any | null>(null);
  const [workingDoc, setWorkingDoc] = useState<any | null>(null);

  // Local state for the "New Tag" subform
  const [newItem, setNewItem] = useState<Record<string, string>>({ key: '', value: '' });

  const tpl: Template | null = useMemo(() => {
    try { return YAML.load(yamlText) as Template; } catch { return null; }
  }, [yamlText]);

  async function handleSeed() {
    const createdTpl = await api<{ id: string; yaml: string }>('/templates', {
      method: 'POST',
      body: JSON.stringify({ yaml: yamlText, name: 'Bench4' }),
    });
    setTplId(createdTpl.id);

    // Seed tags array with one object
    const createdObj = await api<{ id: string }>('/objects', {
      method: 'POST',
      body: JSON.stringify({
        doc: {
          tags: [{ key: 'role', value: 'admin' }]
        }
      }),
    });
    setObjId(createdObj.id);

    const got = await api<{ id: string; doc: any }>(`/objects/${createdObj.id}`);
    setOriginalDoc(got.doc);
    setWorkingDoc(JSON.parse(JSON.stringify(got.doc)));
  }

  const patch = useMemo<Operation[]>(() => {
    if (!originalDoc || !workingDoc) return [];
    const full = jsonpatch.compare(originalDoc, workingDoc) as Operation[];
    // You might see add '/tags/1' instead of '/tags/-' — both are fine.
    return full.filter((op: Operation) => op.op === 'add' || op.op === 'replace' || op.op === 'remove');
  }, [originalDoc, workingDoc]);

  async function applyPatch() {
    if (!objId) return;
    const updated = await api<{ id: string; doc: any }>(
      `/objects/${objId}/applyPatch`,
      { method: 'POST', body: JSON.stringify({ patch }) }
    );
    setOriginalDoc(updated.doc);
    setWorkingDoc(JSON.parse(JSON.stringify(updated.doc)));
  }

  function renderList(w: ListWidget) {
    if (!workingDoc) return null;
    const arrPath = w.binding.path;
    const arr = getAtPointer(workingDoc, arrPath) as any[] | undefined;

    // Render existing items
    const items = Array.isArray(arr) ? arr : [];

    return (
      <div style={{ marginBottom: 16 }}>
        <h4 style={{ margin: '8px 0' }}>{w.label}</h4>

        {items.length === 0 && <div style={{ opacity: 0.7 }}>No items.</div>}

        {items.map((_, idx) => (
          <div key={`${arrPath}/${idx}`} style={{ border: '1px solid #eee', borderRadius: 8, padding: 10, marginBottom: 8 }}>
            <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>Item #{idx}</div>
            {w.item.fields.map((f) => {
              const fieldPath = joinPointer(`${arrPath}/${idx}`, f.binding.path);
              const value = getAtPointer(workingDoc, fieldPath) ?? '';
              return (
                <div key={fieldPath} style={{ marginBottom: 8 }}>
                  <label style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>{f.label}</label>
                  <input
                    value={value}
                    onChange={(e) => {
                      const next = JSON.parse(JSON.stringify(workingDoc));
                      setAtPointer(next, fieldPath, e.target.value);
                      setWorkingDoc(next);
                    }}
                    style={{ padding: 8, width: 360 }}
                  />
                  <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>{fieldPath}</div>
                </div>
              );
            })}
          </div>
        ))}

        {/* New item composer */}
        <div style={{ borderTop: '1px dashed #ddd', paddingTop: 12, marginTop: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>New Tag</div>
          {w.item.fields.map((f) => (
            <div key={`new-${f.id}`} style={{ marginBottom: 8 }}>
              <label style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>{f.label}</label>
              <input
                value={newItem[f.id] ?? ''}
                onChange={(e) => setNewItem((prev) => ({ ...prev, [f.id]: e.target.value }))}
                style={{ padding: 8, width: 360 }}
                placeholder={f.id}
              />
            </div>
          ))}
          <button
            onClick={() => {
              // Build the object according to item.fields binding paths
              const obj: any = {};
              for (const f of w.item.fields) {
                // f.binding.path like "/key" or "/value"
                const seg = f.binding.path.slice(1); // remove leading '/'
                if (!seg) continue;
                obj[seg] = newItem[f.id] ?? '';
              }

              const next = JSON.parse(JSON.stringify(workingDoc));
              const currentArr = getAtPointer(next, arrPath);
              if (!Array.isArray(currentArr)) {
                // If array missing, initialize
                setAtPointer(next, arrPath, [obj]);
              } else {
                currentArr.push(obj);
              }
              setWorkingDoc(next);
              setNewItem({ key: '', value: '' });
            }}
            style={{ padding: '8px 12px' }}
            disabled={w.item.fields.some(f => (newItem[f.id] ?? '').trim() === '')}
          >
            Add Tag
          </button>
          <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>
            Appending emits an <code>add</code> op (often <code>/tags/1</code>); server treats it as append.
          </div>
        </div>
      </div>
    );
  }

  const canRender = Boolean(tpl && tpl.layout?.type === 'vertical' && originalDoc && workingDoc);

  return (
    <main style={{ maxWidth: 900 }}>
      <h1>Benchmark 4 — List (array of objects) · append via subform</h1>

      <details open style={{ margin: '12px 0 20px' }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>YAML Template</summary>
        <textarea
          value={yamlText}
          onChange={(e) => setYamlText(e.target.value)}
          style={{ width: '100%', height: 260, fontFamily: 'monospace', fontSize: 14 }}
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
            {(() => {
              // typed locals
              const children: string[] = (tpl.layout?.children ?? []) as string[];
              const widgetsArr: Widget[] = (tpl.widgets ?? []) as Widget[];

              return children.map((childId: string) => {
                const w = widgetsArr.find((x) => x.id === childId);
                if (!w) return <div key={childId} style={{ color: 'crimson' }}>Missing widget: {childId}</div>;
                if (w.type !== 'list') return <div key={childId} style={{ color: 'crimson' }}>Unsupported widget type</div>;
                return <div key={childId}>{renderList(w)}</div>;
              });
            })()}
          </section>

          <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <h4 style={{ margin: '8px 0' }}>Patch Preview</h4>
              <pre style={{ background: '#f7f7f7', padding: 12, borderRadius: 8, maxHeight: 280, overflow: 'auto' }}>
                {JSON.stringify(patch, null, 2)}
              </pre>
              <button onClick={applyPatch} disabled={patch.length === 0} style={{ padding: '8px 12px' }}>
                Apply Patch
              </button>
            </div>
            <div>
              <h4 style={{ margin: '8px 0' }}>Current JSON</h4>
              <pre style={{ background: '#f7f7f7', padding: 12, borderRadius: 8, maxHeight: 280, overflow: 'auto' }}>
                {JSON.stringify(workingDoc, null, 2)}
              </pre>
            </div>
          </section>
        </>
      ) : null}
    </main>
  );
}
