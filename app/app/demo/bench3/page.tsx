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

/* ---------- Resolve ${...} in binding paths ---------- */
function resolveBindingPath(bindingPath: string, doc: any): string | null {
  if (!bindingPath.includes('${')) return bindingPath;
  // Replace each ${<pointer>} with the string value found at that pointer
  return (
    bindingPath.replace(/\$\{([^}]+)\}/g, (_m, innerPtr: string) => {
      const val = getAtPointer(doc, innerPtr);
      if (typeof val !== 'string' || !val.startsWith('/')) return ''; // unresolved → empty
      return val;
    }) || null
  );
}

/* ---------- Demo YAML (Benchmark 3) ---------- */
const DEMO_YAML = `
version: 1
name: "Field-picker → relative text"
widgets:
  - id: picker
    type: field-picker
    label: "Pick a contact to edit"
    options: { basePath: "/contacts", selection: "single" }
    binding: { path: "/_pending/target" }
  - id: phone
    type: text
    label: "Phone (relative)"
    binding: { path: "\${/_pending/target}/phone" }
layout:
  type: vertical
  children: [picker, phone]
`.trim();

/* ---------- Types ---------- */
type FieldPickerOptions = { basePath: string; selection: 'single' | 'multiple' };
type Widget =
  | { id: string; type: 'field-picker'; label: string; binding: { path: string }; options: FieldPickerOptions }
  | { id: string; type: 'text'; label: string; binding: { path: string } };

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
export default function Bench3Page() {
  const [yamlText, setYamlText] = useState(DEMO_YAML);
  const [tplId, setTplId] = useState<string | null>(null);
  const [objId, setObjId] = useState<string | null>(null);

  const [originalDoc, setOriginalDoc] = useState<any | null>(null);
  const [workingDoc, setWorkingDoc] = useState<any | null>(null);

  const tpl: Template | null = useMemo(() => {
    try {
      return YAML.load(yamlText) as Template;
    } catch {
      return null;
    }
  }, [yamlText]);

  async function handleSeed() {
    const createdTpl = await api<{ id: string; yaml: string }>('/templates', {
      method: 'POST',
      body: JSON.stringify({ yaml: yamlText, name: 'Bench3' }),
    });
    setTplId(createdTpl.id);

    // Seed contacts + empty target
    const createdObj = await api<{ id: string }>('/objects', {
      method: 'POST',
      body: JSON.stringify({
        doc: {
          contacts: { home: { phone: '' }, work: { phone: '' } },
          _pending: {},
        },
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
    return full.filter(
      (op: Operation) => op.op === 'add' || op.op === 'replace' || op.op === 'remove'
    );
  }, [originalDoc, workingDoc]);

  async function applyPatch() {
    if (!objId) return;
    const updated = await api<{ id: string; doc: any }>(`/objects/${objId}/applyPatch`, {
      method: 'POST',
      body: JSON.stringify({ patch }),
    });
    setOriginalDoc(updated.doc);
    setWorkingDoc(JSON.parse(JSON.stringify(updated.doc)));
  }

  /* ---------- UI helpers ---------- */
  function renderFieldPicker(w: Extract<Widget, { type: 'field-picker' }>) {
    if (!workingDoc) return null;
    const basePath = w.options.basePath;
    const baseObj = getAtPointer(workingDoc, basePath);
    const selectedPointer = getAtPointer(workingDoc, w.binding.path) as string | null;

    const entries: { key: string; pointer: string }[] = [];
    if (baseObj && typeof baseObj === 'object') {
      for (const k of Object.keys(baseObj)) {
        const ptr = `${basePath}/${encodePointerSegment(k)}`;
        entries.push({ key: k, pointer: ptr });
      }
    }

    return (
      <div key={w.id} style={{ marginBottom: 12 }}>
        <label style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>{w.label}</label>
        <div style={{ display: 'flex', gap: 12 }}>
          {entries.map(({ key, pointer }) => (
            <label key={pointer} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="radio"
                name="fieldPicker"
                checked={selectedPointer === pointer}
                onChange={() => {
                  const next = JSON.parse(JSON.stringify(workingDoc));
                  setAtPointer(next, w.binding.path, pointer); // write absolute pointer string
                  setWorkingDoc(next);
                }}
              />
              {key} <span style={{ opacity: 0.6, fontSize: 12 }}>({pointer})</span>
            </label>
          ))}
        </div>
        {!entries.length && <div style={{ opacity: 0.7 }}>No keys under {basePath}</div>}
      </div>
    );
  }

  function renderText(w: Extract<Widget, { type: 'text' }>) {
    if (!workingDoc) return null;
    const resolvedPath = resolveBindingPath(w.binding.path, workingDoc);
    const value = resolvedPath ? getAtPointer(workingDoc, resolvedPath) : '';

    return (
      <div key={w.id} style={{ marginBottom: 12 }}>
        <label style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>{w.label}</label>
        <input
          value={value ?? ''}
          onChange={(e) => {
            if (!resolvedPath) return;
            const next = JSON.parse(JSON.stringify(workingDoc));
            setAtPointer(next, resolvedPath, e.target.value);
            setWorkingDoc(next);
          }}
          style={{ padding: 8, width: 320 }}
          disabled={!resolvedPath}
          placeholder={!resolvedPath ? 'Select a target above…' : ''}
        />
        <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
          Resolved path: {resolvedPath ?? '—'}
        </div>
      </div>
    );
  }

  function renderWidget(w: Widget) {
    if (w.type === 'field-picker') return renderFieldPicker(w);
    if (w.type === 'text') return renderText(w);
    // Fallback: don't touch `w` here; parent already provides the key.
    return <div style={{ color: 'crimson' }}>Unsupported widget type</div>;
    }


  const canRender = Boolean(tpl && tpl.layout?.type === 'vertical' && originalDoc && workingDoc);

  return (
    <main style={{ maxWidth: 900 }}>
      <h1>Benchmark 3 — Runtime targeting (field-picker + relative binding)</h1>

      <details open style={{ margin: '12px 0 20px' }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>YAML Template</summary>
        <textarea
          value={yamlText}
          onChange={(e) => setYamlText(e.target.value)}
          style={{ width: '100%', height: 220, fontFamily: 'monospace', fontSize: 14 }}
        />
        <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
          <button onClick={handleSeed} style={{ padding: '8px 12px' }}>
            Seed Template + Object
          </button>
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
                const children: string[] = (tpl.layout?.children ?? []) as string[];
                const widgetsArr: Widget[] = (tpl.widgets ?? []) as Widget[];

                return children.map((childId: string) => {
                const w: Widget | undefined = widgetsArr.find((x: Widget) => x.id === childId);
                if (!w) {
                    return (
                    <div key={childId} style={{ color: 'crimson' }}>
                        Missing widget: {childId}
                    </div>
                    );
                }
                return <div key={childId}>{renderWidget(w)}</div>;
                });
            })()}
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
      ) : null}
    </main>
  );
}
