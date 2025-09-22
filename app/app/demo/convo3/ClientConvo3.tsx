'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Flux4Bots,
  MemoryDocumentStore,
  type Template,
  type Operation,
  type ActionRegistry,
} from '../../../lib/flux4bots';
import { applyPatch as applyOps } from '../../../lib/flux4bots';

type LoadedStep = {
  templatePath: string;
  mode: 'diff' | 'explicit';
  template: Template;
};

type ConvStep = {
  templatePath: string;
  mode: 'diff' | 'explicit';
  ops: Operation[];
  at: string;
};

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

export default function ClientConvo3({
  title: initialTitle,
  initialDoc,
  steps: loaded,
}: {
  title: string;
  initialDoc: any;
  steps: LoadedStep[];
}) {
  const [title, setTitle] = useState(initialTitle);
  const [committed, setCommitted] = useState<ConvStep[]>([]);
  const [currentDoc, setCurrentDoc] = useState<any>(initialDoc);

  // ✅ Actions must return Operation[]
  const actions: ActionRegistry = useMemo(() => ({
    // Expects an unbound text widget capturing something like "sectionsCsv" (e.g., "contacts, social_links, projects")
    'create-sections': ({ vars }): Operation[] => {
      const csv = String(vars.sectionsCsv ?? '').trim();
      if (!csv) return [];
      const names = csv.split(',').map(s => s.trim()).filter(Boolean);
      const ops: Operation[] = [];
      for (const name of names) {
        // create each top-level section as an empty object
        ops.push({ op: 'add', path: `/${name.replace(/~/g, '~0').replace(/\//g, '~1')}`, value: {} });
      }
      return ops;
    },

    // Optional example: create a list under a chosen section (e.g., /projects = [])
    'create-list-under-section': ({ vars }): Operation[] => {
      const section = String(vars.sectionName ?? '').trim();
      const key = String(vars.listKey ?? '').trim();
      if (!section || !key) return [];
      const secEnc = section.replace(/~/g, '~0').replace(/\//g, '~1');
      const keyEnc = key.replace(/~/g, '~0').replace(/\//g, '~1');
      return [{ op: 'add', path: `/${secEnc}/${keyEnc}`, value: [] }];
    },

    // Optional example: push an object with arbitrary fields into a list
    'push-object-to-list': ({ vars }): Operation[] => {
      // expects vars.listPath (absolute pointer to an array) and vars.json (stringified object)
      const listPath = String(vars.listPath ?? '').trim(); // e.g., "/projects"
      const raw = String(vars.json ?? '').trim();
      if (!listPath || !raw) return [];
      let obj: any;
      try { obj = JSON.parse(raw); } catch { return []; }
      // Using 'add' at "/projects/-" to append
      return [{ op: 'add', path: `${listPath}/-`, value: obj }];
    },
  }), []);

  const [store, setStore] = useState<AutoCommitStore>(() =>
    new AutoCommitStore(initialDoc, (ops, updated) => {
      if (ops.length === 0) return;
      setCommitted(prev => {
        const stepDef = loaded[prev.length];
        if (!stepDef) return prev;
        const next: ConvStep = { templatePath: stepDef.templatePath, mode: stepDef.mode, ops, at: new Date().toISOString() };
        return [...prev, next];
      });
      setCurrentDoc(updated);
    })
  );

  const curIndex = committed.length;
  const curStep = loaded[curIndex] ?? null;

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => { const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight; }, [committed.length]);

  async function onUndoLast() {
    if (committed.length === 0) return;
    const nextSteps = committed.slice(0, -1);
    let doc = initialDoc;
    for (const st of nextSteps) doc = applyOps(doc, st.ops);
    setCommitted(nextSteps);
    setCurrentDoc(doc);
    store.resetTo(doc);
  }

  const docsAfterStep = useMemo(() => {
    const arr: any[] = [];
    let doc = initialDoc;
    for (const st of committed) { doc = applyOps(doc, st.ops); arr.push(doc); }
    return arr;
  }, [committed, initialDoc]);

  const uiFlags = useMemo(() => ({
    showPatchPreview: true,
    showApplyButton: true,
    showCurrentJson: false,
  }), []);

  return (
    <main style={{ height: '100vh', display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
      {/* Left: transcript */}
      <div style={{ borderRight: '1px solid #e5e5e5', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
          {committed.map((st, i) => {
            const stepDef = loaded[i];
            const docAt = docsAfterStep[i];
            const opLines = summarizeOps(st.ops);
            return (
              <div key={i} style={{ marginBottom: 16 }}>
                <div style={{
                  maxWidth: '85%',
                  background: '#e8f0fe',
                  border: '1px solid #c6dafc',
                  borderRadius: 12,
                  padding: '8px 10px',
                  display: 'inline-block'
                }}>
                  <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>
                    {stepDef?.template.name ?? stepDef?.templatePath} ({st.mode})
                  </div>
                  {opLines.map((l, idx) => <div key={idx}>{l}</div>)}
                  {i === committed.length - 1 && (
                    <div style={{ marginTop: 6 }}>
                      <a href="#" onClick={(e) => { e.preventDefault(); onUndoLast(); }} style={{ fontSize: 12, color: '#0b57d0', textDecoration: 'underline' }}>
                        Undo
                      </a>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Composer */}
        <div style={{ padding: 12, borderTop: '1px solid #e5e5e5' }}>
          {!curStep ? (
            <div style={{ opacity: 0.8 }}>Flow complete.</div>
          ) : (
            <Flux4Bots
              template={curStep.template}
              store={store as any}
              mode={curStep.mode}
              actions={curStep.mode === 'explicit' ? actions : undefined}
              ui={uiFlags}
            />
          )}
        </div>
      </div>

      {/* Right: JSON + top controls */}
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 12, borderBottom: '1px solid #e5e5e5' }}>
          <button
            onClick={() => {
              setTitle(crypto.randomUUID());
              setCommitted([]);
              setCurrentDoc(initialDoc);
              store.resetTo(initialDoc);
            }}
            style={{ padding: '8px 12px' }}
          >
            + New
          </button>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 12, opacity: 0.7 }}>Rename:</span>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              style={{ padding: '6px 8px', border: '1px solid #ddd', borderRadius: 8, minWidth: 220 }}
            />
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
          <pre style={{ background: '#f7f7f7', padding: 12, borderRadius: 8, minHeight: '100%', boxSizing: 'border-box' }}>
            {JSON.stringify(currentDoc, null, 2)}
          </pre>
        </div>
      </div>
    </main>
  );
}
