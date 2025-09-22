'use client';

import { useMemo, useState } from 'react';
import * as YAML from 'js-yaml';
import * as jsonpatch from 'fast-json-patch';
import type { Operation } from 'fast-json-patch';

const BASE = process.env.NEXT_PUBLIC_SERVER_BASE_URL ?? 'http://localhost:8000';

// --- JSON Pointer helpers (minimal) ---
function decodePointerSegment(seg: string) {
  return seg.replace(/~1/g, '/').replace(/~0/g, '~');
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

// --- Demo YAML (Benchmark 2) ---
const DEMO_YAML = `
version: 1
name: "Email picker"
widgets:
  - id: email
    type: select
    label: "Choose email"
    options: { source: "json", path: "/emails" }
    binding: { path: "/chosen" }
layout:
  type: vertical
  children: [email]
`.trim();

type SelectOptions = { values?: string[]; source?: 'json'; path?: string };
type Widget =
  | { id: string; type: 'select'; label: string; binding: { path: string }; options?: SelectOptions };

type Template = {
  version: number;
  name: string;
  widgets: Widget[];
  layout: { type: 'vertical'; children: string[] };
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

export default function Bench2Page() {
  const [yamlText, setYamlText] = useState(DEMO_YAML);
  const [tplId, setTplId] = useState<string | null>(null);
  const [objId, setObjId] = useState<string | null>(null);

  const [originalDoc, setOriginalDoc] = useState<any | null>(null);
  const [workingDoc, setWorkingDoc] = useState<any | null>(null);

  const tpl: Template | null = useMemo(() => {
    try { return YAML.load(yamlText) as Template; } catch { return null; }
  }, [yamlText]);

  async function handleSeed() {
    const createdTpl = await api<{ id: string; yaml: string }>('/templates', {
      method: 'POST',
      body: JSON.stringify({ yaml: yamlText, name: 'Bench2' }),
    });
    setTplId(createdTpl.id);

    const createdObj = await api<{ id: string }>('/objects', {
      method: 'POST',
      body: JSON.stringify({ doc: { emails: ['a@x.com', 'b@y.com'], chosen: null } }),
    });
    setObjId(createdObj.id);

    const got = await api<{ id: string; doc: any }>(`/objects/${createdObj.id}`);
    setOriginalDoc(got.doc);
    setWorkingDoc(JSON.parse(JSON.stringify(got.doc)));
  }

  const patch = useMemo<Operation[]>(() => {
    if (!originalDoc || !workingDoc) return [];
    const full = jsonpatch.compare(originalDoc, workingDoc) as Operation[];
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

  function renderWidget(w: Widget) {
    if (!workingDoc) return null;
    const value = getAtPointer(workingDoc, w.binding.path);

    if (w.type === 'select') {
      let options: string[] = [];
      if (w.options?.source === 'json' && w.options?.path) {
        const fromJson = getAtPointer(workingDoc, w.options.path);
        if (Array.isArray(fromJson)) options = fromJson.filter(v => typeof v === 'string');
      } else if (w.options?.values) {
        options = w.options.values;
      }

      return (
        <div key={w.id} style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>{w.label}</label>
          <select
            value={value ?? ''}
            onChange={e => {
              const next = JSON.parse(JSON.stringify(workingDoc));
              setAtPointer(next, w.binding.path, e.target.value);
              setWorkingDoc(next);
            }}
            style={{ padding: 8, width: 360 }}
          >
            <option value="" disabled>— select —</option>
            {options.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
          <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
            Options source: {w.options?.source === 'json' ? `JSON at ${w.options?.path}` : 'static'}
          </div>
        </div>
      );
    }

    return <div key={w.id} style={{ color: 'crimson' }}>Unsupported widget: {w.type}</div>;
  }

  const canRender = Boolean(tpl && tpl.layout?.type === 'vertical' && originalDoc && workingDoc);

  return (
    <main style={{ maxWidth: 900 }}>
      <h1>Benchmark 2 — Dynamic options from JSON</h1>

      <details open style={{ margin: '12px 0 20px' }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>YAML Template</summary>
        <textarea
          value={yamlText}
          onChange={e => setYamlText(e.target.value)}
          style={{ width: '100%', height: 200, fontFamily: 'monospace', fontSize: 14 }}
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

      {canRender && tpl && (
        <>
          <section style={{ padding: 12, border: '1px solid #ddd', borderRadius: 8, marginBottom: 16 }}>
            <h3 style={{ marginTop: 0 }}>{tpl.name}</h3>
            {tpl.layout.children.map(childId => {
              const w = tpl.widgets.find(x => x.id === childId);
              return w ? renderWidget(w) : null;
            })}
          </section>

          <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <h4 style={{ margin: '8px 0' }}>Patch Preview</h4>
              <pre style={{ background: '#f7f7f7', padding: 12, borderRadius: 8, maxHeight: 260, overflow: 'auto' }}>
                {JSON.stringify(patch, null, 2)}
              </pre>
              <button onClick={applyPatch} disabled={patch.length === 0} style={{ padding: '8px 12px' }}>
                Apply Patch
              </button>
            </div>
            <div>
              <h4 style={{ margin: '8px 0' }}>Current JSON</h4>
              <pre style={{ background: '#f7f7f7', padding: 12, borderRadius: 8, maxHeight: 260, overflow: 'auto' }}>
                {JSON.stringify(workingDoc, null, 2)}
              </pre>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
