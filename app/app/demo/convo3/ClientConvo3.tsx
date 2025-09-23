'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Flux4Bots,
  MemoryDocumentStore,
  type Template,
  type Operation,
  type ActionRegistry,
  applyPatch as applyOps,
} from '../../../lib/flux4bots';

type LoadedStep = {
  templatePath: string;
  mode: 'diff' | 'explicit';
  template: Template;
};
type ConvStep = {
  templatePath: string;
  mode: 'diff' | 'explicit';
  ops: Operation[];
  at: string; // ISO
};

const BASE = process.env.NEXT_PUBLIC_SERVER_BASE_URL ?? 'http://localhost:8000';

/* ---------------- API ---------------- */
async function api<T>(p: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${p}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}
async function createConversation(title: string, initial: any) {
  return api<{ id: string; title: string }>('/conversations', {
    method: 'POST',
    body: JSON.stringify({ title, initial }),
  });
}
async function listConversations() {
  return api<{ items: { id: string; title: string; updated_at: string }[] }>('/conversations');
}
async function getConversation(id: string) {
  return api<{ id: string; title: string; initial: any; steps: ConvStep[] }>(`/conversations/${id}`);
}
async function renameConversation(id: string, title: string) {
  return api<{ ok: boolean }>(`/conversations/${id}/title`, { method: 'PATCH', body: JSON.stringify({ title }) });
}
async function appendStep(id: string, step: Omit<ConvStep, 'at'>) {
  return api<{ ok: boolean }>(`/conversations/${id}/appendStep`, { method: 'POST', body: JSON.stringify(step) });
}
async function undoLast(id: string) {
  return api<{ ok: boolean }>(`/conversations/${id}/undo`, { method: 'POST' });
}

/* -------------- utils --------------- */
function summarizeOps(ops: Operation[]) {
  return ops.map(o => {
    if (o.op === 'remove') return `remove ${o.path}`;
    if (o.op === 'add') return `add ${o.path} = ${JSON.stringify(o.value)}`;
    return `replace ${o.path} = ${JSON.stringify(o.value)}`;
  });
}

class AutoCommitStore {
  private inner: MemoryDocumentStore;
  private onCommitted: (ops: Operation[], updatedDoc: any) => void;

  constructor(initialDoc: any, onCommitted: (ops: Operation[], updatedDoc: any) => void) {
    this.inner = new MemoryDocumentStore(initialDoc);
    this.onCommitted = onCommitted;
  }
  async getDoc(): Promise<any> { return this.inner.getDoc(); }
  async applyPatch(ops: Operation[]): Promise<any> {
    const updated = await this.inner.applyPatch(ops);
    this.onCommitted(ops, updated);
    return updated;
  }
  resetTo(doc: any) { this.inner = new MemoryDocumentStore(doc); }
}

/* -------------- component ------------ */
export default function ClientConvo3({
  title: initialTitle,
  initialDoc,
  steps: loaded,
}: {
  title: string;
  initialDoc: any;
  steps: LoadedStep[];
}) {
  // persistence
  const [convId, setConvId] = useState<string | null>(null);
  const [title, setTitle] = useState(initialTitle);
  const [list, setList] = useState<{ id: string; title: string }[]>([]);

  // transcript & doc
  const [committed, setCommitted] = useState<ConvStep[]>([]);
  const [currentDoc, setCurrentDoc] = useState<any>(initialDoc);

  // explicit actions used by convo3 steps
  const actions: ActionRegistry = useMemo(() => ({
    'create-sections': ({ vars }) => {
      const csv = String(vars.sectionsCsv ?? '').trim();
      if (!csv) return [];
      const names = csv.split(',').map(s => s.trim()).filter(Boolean);
      const ops: Operation[] = [];
      for (const name of names) {
        const enc = name.replace(/~/g, '~0').replace(/\//g, '~1');
        ops.push({ op: 'add', path: `/${enc}`, value: {} });
      }
      return ops;
    },
    'create-list-under-section': ({ vars }) => {
      const section = String(vars.sectionName ?? '').trim();
      const key = String(vars.listKey ?? '').trim();
      if (!section || !key) return [];
      const secEnc = section.replace(/~/g, '~0').replace(/\//g, '~1');
      const keyEnc = key.replace(/~/g, '~0').replace(/\//g, '~1');
      return [{ op: 'add', path: `/${secEnc}/${keyEnc}`, value: [] }];
    },
    'push-object-to-list': ({ vars }) => {
      const listPath = String(vars.listPath ?? '').trim();
      const raw = String(vars.json ?? '').trim();
      if (!listPath || !raw) return [];
      let obj: any; try { obj = JSON.parse(raw); } catch { return []; }
      return [{ op: 'add', path: `${listPath}/-`, value: obj }];
    },
  }), []);

  // auto-commit store + persistence hook
  const [store] = useState<AutoCommitStore>(() =>
    new AutoCommitStore(initialDoc, async (ops, updated) => {
      if (ops.length === 0) return;

      // local commit
      setCommitted(prev => {
        const stepDef = loaded[prev.length];
        if (!stepDef) return prev;
        const next: ConvStep = {
          templatePath: stepDef.templatePath,
          mode: stepDef.mode,
          ops,
          at: new Date().toISOString(),
        };
        return [...prev, next];
      });
      setCurrentDoc(updated);

      // persist to server
      const stepDef = loaded[committed.length];
      if (convId && stepDef) {
        try {
          await appendStep(convId, {
            templatePath: stepDef.templatePath,
            mode: stepDef.mode,
            ops,
          });
          const l = await listConversations();
          setList(l.items.map(i => ({ id: i.id, title: i.title })));
        } catch {}
      }
    })
  );

  // load conversation list initially
  useEffect(() => {
    (async () => {
      try {
        const l = await listConversations();
        setList(l.items.map(i => ({ id: i.id, title: i.title })));
      } catch {}
    })();
  }, []);

  // current step pointer
  const curIndex = committed.length;
  const curStep = loaded[curIndex] ?? null;

  // transcript auto-scroll (scroll to bottom on append)
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [committed.length]);

  // actions: New, Load, Rename, Undo
  async function onNew() {
    try {
      const created = await createConversation(crypto.randomUUID(), initialDoc);
      setConvId(created.id);
      setTitle(created.title);
      setCommitted([]);
      setCurrentDoc(initialDoc);
      store.resetTo(initialDoc);
      const l = await listConversations();
      setList(l.items.map(i => ({ id: i.id, title: i.title })));
    } catch {
      // fallback local-only
      setConvId(null);
      setTitle(crypto.randomUUID());
      setCommitted([]);
      setCurrentDoc(initialDoc);
      store.resetTo(initialDoc);
    }
  }

  async function onLoad(id: string) {
    try {
      const c = await getConversation(id);
      setConvId(c.id);
      setTitle(c.title);
      // replay steps
      let doc = c.initial;
      for (const st of c.steps) doc = applyOps(doc, st.ops);
      setCommitted(c.steps);
      setCurrentDoc(doc);
      store.resetTo(doc);
    } catch {}
  }

  async function onRename(newTitle: string) {
    setTitle(newTitle);
    if (convId) { try { await renameConversation(convId, newTitle); } catch {} }
  }

  async function onUndoLast() {
    if (committed.length === 0) return;
    const nextSteps = committed.slice(0, -1);
    // recompute doc
    let doc = initialDoc;
    for (const st of nextSteps) doc = applyOps(doc, st.ops);
    setCommitted(nextSteps);
    setCurrentDoc(doc);
    store.resetTo(doc);
    if (convId) { try { await undoLast(convId); } catch {} }
  }

  const uiFlags = useMemo(() => ({
    showPatchPreview: true,
    showApplyButton: true,
    showCurrentJson: false,
  }), []);

  return (
    <main className="h-full grid grid-cols-2">
      {/* Left: chat column */}
      <div className="border-r border-slate-200 flex flex-col min-h-0">
        {/* Transcript scroll area */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-4">
          {committed.length === 0 && (
            <div className="text-slate-500 mt-2">Start applying changes using the form below.</div>
          )}
          {committed.map((st, i) => {
            const opLines = summarizeOps(st.ops);
            return (
              <div key={i} className="space-y-2">
                <div className="inline-block max-w-[85%] rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2">
                  <div className="text-[12px] text-slate-500 mb-1">
                    {st.mode} • {new Date(st.at).toLocaleTimeString()}
                  </div>
                  {opLines.map((l, idx) => <div key={idx}>{l}</div>)}
                  {i === committed.length - 1 && (
                    <div className="mt-2">
                      <button className="text-[12px] text-blue-700 underline" onClick={onUndoLast} type="button">
                        Undo
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Composer pinned at bottom */}
        <div className="border-t border-slate-200 p-3">
          {!curStep ? (
            <div className="text-slate-600">Flow complete.</div>
          ) : (
            <Flux4Bots
              template={curStep.template}
              store={store as any}
              mode={curStep.mode}
              actions={curStep.mode === 'explicit' ? actions : undefined}
              ui={uiFlags}
            />
          )}
          <div className="text-[12px] text-slate-500 mt-2">
            Tip: Click <b>Apply Patch</b> above to commit this step.
          </div>
        </div>
      </div>

      {/* Right: JSON + top controls */}
      <div className="flex flex-col min-h-0">
        <div className="border-b border-slate-200 p-3 flex items-center gap-2">
          <button onClick={onNew} className="px-3 py-2 rounded-lg bg-slate-900 text-white text-sm" type="button">
            + New
          </button>

          <select
            className="px-2 py-2 border border-slate-300 rounded-lg text-sm"
            value={convId ?? ''}
            onChange={e => onLoad(e.target.value)}
          >
            <option value="" disabled>Load…</option>
            {list.map(item => (
              <option key={item.id} value={item.id}>{item.title}</option>
            ))}
          </select>

          <div className="ml-auto flex items-center gap-2">
            <span className="text-[12px] text-slate-500">Rename:</span>
            <input
              className="px-2 py-2 border border-slate-300 rounded-lg text-sm min-w-[220px]"
              value={title}
              onChange={e => onRename(e.target.value)}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          <pre className="bg-slate-50 rounded-lg p-3 min-h-full">{JSON.stringify(currentDoc, null, 2)}</pre>
        </div>
      </div>
    </main>
  );
}
