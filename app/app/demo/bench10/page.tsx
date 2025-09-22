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

/* ---------- Demo YAML (Benchmark 10) ---------- */
const DEMO_YAML = `
version: 1
name: "Wizard: Multi-step ops"
widgets:
  - id: task
    type: select
    label: "Choose Task"
    options: { values: ["Set contact phone","Append tag","Delete meta keys"] }
  - id: preview
    type: action
    label: "Preview Ops"
    options: { action: "compose-ops" }
layout:
  type: vertical
  children: [task, preview]
`.trim();

/* ---------- Types (for this page) ---------- */
type SelectWidget = { id: string; type: 'select'; label: string; options?: { values?: string[] } };
type ActionWidget  = { id: string; type: 'action'; label: string; options?: { action?: string } };
type Widget = SelectWidget | ActionWidget;
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

/* ---------- Component ---------- */
export default function Bench10Page() {
  const [yamlText, setYamlText] = useState(DEMO_YAML);
  const [tplId, setTplId] = useState<string | null>(null);
  const [objId, setObjId] = useState<string | null>(null);

  const [originalDoc, setOriginalDoc] = useState<any | null>(null);

  // Explicit ops + live preview of applying them
  const [pendingOps, setPendingOps] = useState<Operation[]>([]);
  const [workingPreview, setWorkingPreview] = useState<any | null>(null);

  // Local UI state (depends on task)
  const [task, setTask] = useState<string>('');
  const [contactKey, setContactKey] = useState<'home' | 'work' | ''>('');
  const [phone, setPhone] = useState<string>('');
  const [newTag, setNewTag] = useState<{ key: string; value: string }>({ key: '', value: '' });
  const [metaKeys, setMetaKeys] = useState<string[]>([]); // selected for deletion

  const tpl: Template | null = useMemo(() => {
    try { return YAML.load(yamlText) as Template; } catch { return null; }
  }, [yamlText]);

  async function handleSeed() {
    const createdTpl = await api<{ id: string; yaml: string }>('/templates', {
      method: 'POST',
      body: JSON.stringify({ yaml: yamlText, name: 'Bench10' }),
    });
    setTplId(createdTpl.id);

    const createdObj = await api<{ id: string }>('/objects', {
      method: 'POST',
      body: JSON.stringify({
        doc: {
          contacts: { home: { phone: '' }, work: { phone: '555-0001' } },
          tags: [{ key: 'role', value: 'admin' }],
          meta: { temp: ['x'], draft: true, notes: 'keep' }
        }
      }),
    });
    setObjId(createdObj.id);

    const got = await api<{ id: string; doc: any }>(`/objects/${createdObj.id}`);
    setOriginalDoc(got.doc);
    setWorkingPreview(got.doc);
    setPendingOps([]);

    // reset local ui
    setTask('');
    setContactKey('');
    setPhone('');
    setNewTag({ key: '', value: '' });
    setMetaKeys([]);
  }

  function composeOps() {
    if (!originalDoc) return;
    const ops: Operation[] = [];

    if (task === 'Set contact phone') {
      if (!contactKey || !phone.trim()) return;
      const path = `/contacts/${encodePointerSegment(contactKey)}/phone`;
      ops.push({ op: 'replace', path, value: phone.trim() });
    }

    if (task === 'Append tag') {
      const k = newTag.key.trim();
      const v = newTag.value.trim();
      if (!k || !v) return;
      // Append to array using '/-'
      ops.push({ op: 'add', path: '/tags/-', value: { key: k, value: v } });
    }

    if (task === 'Delete meta keys') {
      const base = getAtPointer(originalDoc, '/meta');
      const keys = metaKeys.filter(k => base && Object.prototype.hasOwnProperty.call(base, k));
      if (keys.length === 0) return;
      for (const k of keys) {
        ops.push({ op: 'remove', path: `/meta/${encodePointerSegment(k)}` });
      }
    }

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
  }

  /* ---------- Renderers ---------- */
  function renderTaskSelect(w: SelectWidget) {
    const values = w.options?.values ?? [];
    return (
      <div key={w.id} style={{ marginBottom: 12 }}>
        <label style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>{w.label}</label>
        <select
          value={task}
          onChange={e => setTask(e.target.value)}
          style={{ padding: 8, width: 360 }}
        >
          <option value="" disabled>— select —</option>
          {values.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      </div>
    );
  }

  function renderSubform() {
    if (!workingPreview) return null;

    if (task === 'Set contact phone') {
      return (
        <div style={{ border: '1px solid #eee', borderRadius: 8, padding: 10, marginBottom: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Contact</div>
          <div style={{ display: 'flex', gap: 12, marginBottom: 10 }}>
            {(['home','work'] as const).map(k => (
              <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="radio" name="contact" checked={contactKey === k} onChange={() => setContactKey(k)} />
                {k} <span style={{ opacity: 0.6, fontSize: 12 }}>/contacts/{k}/phone</span>
              </label>
            ))}
          </div>
          <label style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>Phone</label>
          <input
            value={phone}
            onChange={e => setPhone(e.target.value)}
            style={{ padding: 8, width: 320 }}
            placeholder="555-1010"
          />
        </div>
      );
    }

    if (task === 'Append tag') {
      return (
        <div style={{ border: '1px solid #eee', borderRadius: 8, padding: 10, marginBottom: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>New Tag</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>Key</label>
              <input
                value={newTag.key}
                onChange={e => setNewTag(prev => ({ ...prev, key: e.target.value }))}
                style={{ padding: 8, width: '100%' }}
                placeholder="team"
              />
            </div>
            <div>
              <label style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>Value</label>
              <input
                value={newTag.value}
                onChange={e => setNewTag(prev => ({ ...prev, value: e.target.value }))}
                style={{ padding: 8, width: '100%' }}
                placeholder="core"
              />
            </div>
          </div>
          <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>
            Will append to <code>/tags/-</code>.
          </div>
        </div>
      );
    }

    if (task === 'Delete meta keys') {
      const base = getAtPointer(workingPreview, '/meta');
      const keys = (base && typeof base === 'object') ? Object.keys(base) : [];
      return (
        <div style={{ border: '1px solid #eee', borderRadius: 8, padding: 10, marginBottom: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Select keys under /meta</div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {keys.map(k => {
              const checked = metaKeys.includes(k);
              return (
                <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={e => {
                      setMetaKeys(prev => e.target.checked ? Array.from(new Set([...prev, k])) : prev.filter(v => v !== k));
                    }}
                  />
                  {k} <span style={{ opacity: 0.6, fontSize: 12 }}>/meta/{encodePointerSegment(k)}</span>
                </label>
              );
            })}
            {keys.length === 0 && <span style={{ opacity: 0.7 }}>No keys under /meta</span>}
          </div>
        </div>
      );
    }

    return null;
  }

  function renderAction(w: ActionWidget) {
    return (
      <div key={w.id} style={{ marginBottom: 12 }}>
        <button
          onClick={composeOps}
          disabled={!task}
          style={{ padding: '8px 12px' }}
          title="Compose explicit JSON Patch ops for the chosen task"
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
    if (w.type === 'select') return <div key={id}>{renderTaskSelect(w)}</div>;
    if (w.type === 'action') return <div key={id}>{renderAction(w)}</div>;
    return <div key={id} style={{ color: 'crimson' }}>Unsupported widget type</div>;
  }

  const canRender = Boolean(tpl && tpl.layout?.type === 'vertical' && originalDoc && workingPreview);

  return (
    <main style={{ maxWidth: 960 }}>
      <h1>Benchmark 10 — Multi-step “wizard” (compose ops)</h1>

      <details open style={{ margin: '12px 0 20px' }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>YAML Template</summary>
        <textarea
          value={yamlText}
          onChange={(e) => setYamlText(e.target.value)}
          style={{ width: '100%', height: 220, fontFamily: 'monospace', fontSize: 14 }}
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
          Click <b>Seed Template + Object</b> to create a doc and render the wizard.
        </p>
      )}

      {canRender && tpl ? (
        <>
          <section style={{ padding: 12, border: '1px solid #ddd', borderRadius: 8, marginBottom: 16 }}>
            <h3 style={{ marginTop: 0 }}>{tpl.name}</h3>
            {tpl.layout.children.map((childId) => (
              <div key={childId}>{renderWidgetById(childId)}</div>
            ))}
            {/* dynamic subform shown between the two widgets */}
            {renderSubform()}
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
