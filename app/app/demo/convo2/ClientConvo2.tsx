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
  at: string; // ISO
};

function summarizeOps(ops: Operation[]) {
  return ops.map(o => {
    if (o.op === 'remove') return `remove ${o.path}`;
    if (o.op === 'add') return `add ${o.path} = ${JSON.stringify(o.value)}`;
    return `replace ${o.path} = ${JSON.stringify(o.value)}`;
  });
}

// Snapshot of bound text/select widgets (absolute bindings only) at a given doc
function widgetSummary(template: Template, doc: any): string[] {
  const out: string[] = [];
  for (const w of template.widgets) {
    if (w.type === 'text' || w.type === 'select') {
      const label = w.label ?? w.id;
      const path = (w as any).binding?.path as string | undefined;
      if (!path || path.includes('${')) continue; // skip unbound/relative here
      const parts = path.split('/').slice(1).map(s => s.replace(/~1/g, '/').replace(/~0/g, '~'));
      let cur: any = doc;
      for (const p of parts) {
        if (cur == null) { cur = undefined; break; }
        cur = cur[p];
      }
      out.push(`${label}: ${JSON.stringify(cur ?? '')}`);
    }
  }
  return out;
}

// Store that auto-commits: when Flux4Bots applies a patch, we append a step & advance.
// NOTE: we do NOT capture curStep in this class; the component passes a callback that
// uses functional setState to keep step index correct.
class AutoCommitStore {
  private inner: MemoryDocumentStore;
  private onCommitted: (ops: Operation[], updatedDoc: any) => void;

  constructor(initialDoc: any, onCommitted: (ops: Operation[], updatedDoc: any) => void) {
    this.inner = new MemoryDocumentStore(initialDoc);
    this.onCommitted = onCommitted;
  }

  async getDoc(): Promise<any> {
    return this.inner.getDoc();
  }

  async applyPatch(ops: Operation[]): Promise<any> {
    const updated = await this.inner.applyPatch(ops);
    this.onCommitted(ops, updated);
    return updated;
  }

  resetTo(doc: any) {
    this.inner = new MemoryDocumentStore(doc);
  }
}

export default function ClientConvo2({
  title: initialTitle,
  initialDoc,
  steps: loaded,
}: {
  title: string;
  initialDoc: any;
  steps: LoadedStep[];
}) {
  // Title (client-only in this milestone)
  const [title, setTitle] = useState<string>(initialTitle);

  // Committed steps & current doc
  const [committed, setCommitted] = useState<ConvStep[]>([]);
  const [currentDoc, setCurrentDoc] = useState<any>(initialDoc);

  // Actions for explicit steps
  const actions: ActionRegistry = useMemo(() => ({
    'create-social-link': (ctx) => {
      const platform = String(ctx.vars.platform ?? '').trim();
      const url = String(ctx.vars.url ?? '').trim();
      if (!platform || !url) return [];
      return [{ op: 'add', path: `/social_links/${ctx.helpers.encode(platform)}`, value: url }];
    },
    'rename-meta-key': (ctx) => {
      const oldKey = String(ctx.vars.oldKey ?? '').trim();
      const newKey = String(ctx.vars.newKey ?? '').trim();
      if (!oldKey || !newKey || oldKey === newKey) return [];
      const oldPath = `/meta/${ctx.helpers.encode(oldKey)}`;
      const newPath = `/meta/${ctx.helpers.encode(newKey)}`;
      const val = ctx.helpers.get(ctx.working ?? ctx.doc, oldPath);
      if (typeof val === 'undefined') return [];
      return [
        { op: 'add', path: newPath, value: val },
        { op: 'remove', path: oldPath },
      ];
    },
    'delete-meta-keys': (ctx) => {
      const csv = String((ctx.vars as any).keysCsv ?? '').trim();
      if (!csv) return [];
      const keys = csv.split(',').map(s => s.trim()).filter(Boolean);
      const ops: Operation[] = [];
      for (const k of keys) {
        const p = `/meta/${ctx.helpers.encode(k)}`;
        const exists = typeof ctx.helpers.get(ctx.working ?? ctx.doc, p) !== 'undefined';
        if (exists) ops.push({ op: 'remove', path: p });
      }
      return ops;
    },
  }), []);

  // Auto-commit store: use functional setState so step index is always accurate
  const [store, setStore] = useState<AutoCommitStore>(() =>
    new AutoCommitStore(initialDoc, (ops, updated) => {
      if (ops.length === 0) return;
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
    })
  );

  // Current step pointer
  const curIndex = committed.length;
  const curStep = loaded[curIndex] ?? null;

  // Transcript auto-scroll
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [committed.length]);

  // New conversation
  function onNew() {
    setTitle(crypto.randomUUID());
    setCommitted([]);
    setCurrentDoc(initialDoc);
    const s = new AutoCommitStore(initialDoc, (ops, updated) => {
      if (ops.length === 0) return;
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
    });
    setStore(s);
  }

  // Undo last step
  async function onUndoLast() {
    if (committed.length === 0) return;
    const nextSteps = committed.slice(0, -1);

    // Replay to recompute doc
    let doc = initialDoc;
    for (const st of nextSteps) doc = applyOps(doc, st.ops);

    setCommitted(nextSteps);
    setCurrentDoc(doc);
    store.resetTo(doc);
  }

  // Doc after each step (for widget summaries)
  const docsAfterStep = useMemo(() => {
    const arr: any[] = [];
    let doc = initialDoc;
    for (const st of committed) {
      doc = applyOps(doc, st.ops);
      arr.push(doc);
    }
    return arr;
  }, [committed, initialDoc]);

  const uiFlags = useMemo(() => ({
    showPatchPreview: true,   // user clicks Apply Patch in the widget
    showApplyButton: true,
    showCurrentJson: false,   // we render JSON on the right
  }), []);

  return (
    <main style={{ height: '100vh', display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
      {/* Left: transcript */}
      <div style={{ borderRight: '1px solid #e5e5e5', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
          {committed.length === 0 && (
            <div style={{ opacity: 0.7, marginTop: 8 }}>Start applying changes using the form below.</div>
          )}

          {committed.map((st, i) => {
            const loadedStep = loaded[i];
            const docAt = docsAfterStep[i];
            const widgetLines = loadedStep ? widgetSummary(loadedStep.template, docAt) : [];
            const opLines = summarizeOps(st.ops);

            return (
              <div key={i} style={{ marginBottom: 16 }}>
                {/* Widget snapshot (gray) */}
                <div style={{
                  maxWidth: '85%',
                  background: '#f8f9fb',
                  border: '1px solid #e1e6ef',
                  borderRadius: 10,
                  padding: '8px 10px',
                  marginBottom: 6
                }}>
                  <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>
                    {loadedStep?.template.name ?? loadedStep?.templatePath} ({st.mode})
                  </div>
                  {widgetLines.length === 0
                    ? <div style={{ fontSize: 13, opacity: 0.8 }}>—</div>
                    : <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                        {widgetLines.map((l, idx) => <li key={idx}>{l}</li>)}
                      </ul>
                  }
                </div>

                {/* Op summary (blue) + Undo on latest */}
                <div style={{
                  maxWidth: '85%',
                  background: '#e8f0fe',
                  border: '1px solid #c6dafc',
                  borderRadius: 12,
                  padding: '8px 10px',
                  display: 'inline-block'
                }}>
                  {opLines.map((l, idx) => <div key={idx}>{l}</div>)}
                  {i === committed.length - 1 && (
                    <div style={{ marginTop: 6 }}>
                      <a
                        href="#"
                        onClick={(e) => { e.preventDefault(); onUndoLast(); }}
                        style={{ fontSize: 12, color: '#0b57d0', textDecoration: 'underline' }}
                      >
                        Undo
                      </a>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Composer (pinned) */}
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

          {/* Load disabled until Milestone 6 */}
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, opacity: 0.5 }}>
            <select disabled>
              <option>Load (coming in Milestone 6)</option>
            </select>
          </div>

          {/* Rename (client-only) */}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 12, opacity: 0.7 }}>Rename:</span>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              style={{ padding: '6px 8px', border: '1px solid #ddd', borderRadius: 8, minWidth: 220 }}
            />
          </div>
        </div>

        {/* JSON preview */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
          <pre style={{ background: '#f7f7f7', padding: 12, borderRadius: 8, minHeight: '100%', boxSizing: 'border-box' }}>
            {JSON.stringify(currentDoc, null, 2)}
          </pre>
        </div>
      </div>
    </main>
  );
}
