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

// Step descriptor from server
type LoadedStep = {
  templatePath: string;
  mode: 'diff' | 'explicit';
  template: Template;
};

// A committed conversation step
type ConvStep = {
  templatePath: string;
  mode: 'diff' | 'explicit';
  ops: Operation[];
  userText?: string;
  at: string; // ISO time
};

// A store wrapper that records last applied ops and lets us observe doc changes
class CapturingStore {
  private inner: MemoryDocumentStore;
  public lastOps: Operation[] = [];
  private onChange?: (doc: any) => void;

  constructor(initialDoc: any, onChange?: (doc: any) => void) {
    this.inner = new MemoryDocumentStore(initialDoc);
    this.onChange = onChange;
  }

  async getDoc(): Promise<any> {
    return this.inner.getDoc();
  }

  async applyPatch(ops: Operation[]): Promise<any> {
    this.lastOps = ops;
    const updated = await this.inner.applyPatch(ops);
    this.onChange?.(updated);
    return updated;
  }

  // Helper: reset to a fresh doc (for Back) and apply history
  static fromHistory(initialDoc: any, steps: ConvStep[], onChange?: (doc: any) => void) {
    const s = new CapturingStore(initialDoc, onChange);
    return (async () => {
      let doc = initialDoc;
      for (const st of steps) {
        doc = applyOps(doc, st.ops);
      }
      // overwrite inner doc by re-creating memory store
      s.inner = new MemoryDocumentStore(doc);
      s.onChange?.(doc);
      return s;
    })();
  }
}

export default function ClientConvo1({
  title: initialTitle,
  initialDoc,
  steps: loaded,
}: {
  title: string;
  initialDoc: any;
  steps: LoadedStep[];
}) {
  // UI state
  const [title, setTitle] = useState<string>(initialTitle);
  const [committed, setCommitted] = useState<ConvStep[]>([]);
  const [currentDoc, setCurrentDoc] = useState<any>(initialDoc);

  // store that Flux4Bots will use; we recreate it on reset/back
  const [store, setStore] = useState<CapturingStore>(() => new CapturingStore(initialDoc, setCurrentDoc));

  // Next step index = number of committed steps
  const curIndex = committed.length;
  const curStep = loaded[curIndex] ?? null;

  // put this near other consts inside ClientConvo1()
const actions: ActionRegistry = {
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
};


  // Transcript scroll handling
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // auto-scroll to bottom on step change
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [committed.length]);

  function onNew() {
    setTitle(crypto.randomUUID());
    setCommitted([]);
    const s = new CapturingStore(initialDoc, setCurrentDoc);
    setStore(s);
    setCurrentDoc(initialDoc);
  }

  async function onBack() {
    if (committed.length === 0) return;
    const nextSteps = committed.slice(0, -1);
    const s = await CapturingStore.fromHistory(initialDoc, nextSteps, setCurrentDoc);
    setCommitted(nextSteps);
    setStore(await s);
  }

  async function onCommit(userText: string) {
    if (!curStep) return;
    const ops = store.lastOps ?? [];
    // Allow zero-op commit? For now, only commit if there are ops.
    if (ops.length === 0) return;

    const entry: ConvStep = {
      templatePath: curStep.templatePath,
      mode: curStep.mode,
      ops: ops,
      userText: userText || undefined,
      at: new Date().toISOString(),
    };
    const nextCommitted = [...committed, entry];
    setCommitted(nextCommitted);

    // Prepare store for next step by leaving current doc as-is (already applied)
    // Clear lastOps so next commit won’t reuse old ones
    store.lastOps = [];
  }

  // Small input to capture the user's short bubble text
  const [userLine, setUserLine] = useState('');

  // UI flags: no Current JSON inside Flux4Bots (we show it on the right)
  const uiFlags = useMemo(() => ({
    showPatchPreview: true,
    showApplyButton: true,
    showCurrentJson: false,
  }), []);

  return (
    <main style={{ height: '100vh', display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
      {/* Left: conversation column */}
      <div style={{ borderRight: '1px solid #e5e5e5', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {/* Transcript */}
        <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
          {committed.length === 0 && (
            <div style={{ opacity: 0.7, marginTop: 8 }}>Start the conversation below.</div>
          )}
          {committed.map((s, i) => (
            <div key={i} style={{ marginBottom: 12 }}>
              {/* user bubble */}
              {s.userText && (
                <div style={{
                  maxWidth: '80%',
                  background: '#e8f0fe',
                  border: '1px solid #c6dafc',
                  borderRadius: 12,
                  padding: '8px 10px',
                  display: 'inline-block'
                }}>
                  {s.userText}
                </div>
              )}
            </div>
          ))}
          {/* If we want to preview which step we're on, we don't show any extra text per your spec */}
        </div>

        {/* Composer pinned to bottom */}
        <div style={{ padding: 12, borderTop: '1px solid #e5e5e5' }}>
          {!curStep ? (
            <div style={{ opacity: 0.8 }}>Flow complete.</div>
          ) : (
            <>
              <div style={{ marginBottom: 8 }}>
                <Flux4Bots
                  template={curStep.template}
                  store={store as any}
                  mode={curStep.mode}
                  actions={actions}
                  ui={uiFlags}
                />
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  value={userLine}
                  onChange={e => setUserLine(e.target.value)}
                  placeholder="say something about this change…"
                  style={{ flex: 1, padding: '8px 10px', border: '1px solid #ddd', borderRadius: 8 }}
                />
                <button onClick={onBack} disabled={committed.length === 0} style={{ padding: '8px 12px' }}>
                  Back
                </button>
                <button
                  onClick={() => { onCommit(userLine); setUserLine(''); }}
                  style={{ padding: '8px 12px' }}
                >
                  Commit Step & Continue
                </button>
              </div>
              <div style={{ fontSize: 12, opacity: 0.6, marginTop: 6 }}>
                Tip: click <b>Apply Patch</b> above to stage changes, then <b>Commit Step & Continue</b>.
              </div>
            </>
          )}
        </div>
      </div>

      {/* Right: JSON + top controls */}
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 12, borderBottom: '1px solid #e5e5e5' }}>
          <button onClick={onNew} style={{ padding: '8px 12px' }}>+ New</button>

          {/* Load is disabled until Milestone 6 */}
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, opacity: 0.5 }}>
            <select disabled>
              <option>Load (coming in Milestone 6)</option>
            </select>
          </div>

          {/* Rename (client-only for now) */}
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
