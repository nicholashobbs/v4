'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Flux4Bots } from '../../../lib/flux4bots'; // keep your existing export
import type { Template, Operation, ActionRegistry } from '../../../lib/flux4bots';

import {
  ConversationEngine,
  type LoadedStep as EngineStep,
} from '../../../lib/flux4bots/engine/ConversationEngine';
import { FastApiAdapter } from '../../../lib/flux4bots/persistence/FastApiAdapter';
import { builtins } from '../../../lib/flux4bots/actions/builtins';

// ---- Props from page.tsx (unchanged shape) ----
type LoadedStep = {
  templatePath: string;
  mode: 'diff' | 'explicit';
  template: Template;
};

const BASE = process.env.NEXT_PUBLIC_SERVER_BASE_URL ?? 'http://localhost:8000';

function summarizeOps(ops: Operation[]) {
  return ops.map(o => {
    if (o.op === 'remove') return `remove ${o.path}`;
    if (o.op === 'add') return `add ${o.path} = ${JSON.stringify(o.value)}`;
    return `replace ${o.path} = ${JSON.stringify(o.value)}`;
  });
}

export default function ClientConvo4({
  title: initialTitle,
  initialDoc,
  steps,
}: {
  title: string;
  initialDoc: any;
  steps: LoadedStep[];
}): JSX.Element {
  // force re-render hook
  const [, bump] = useState(0);
  const force = () => bump(x => x + 1);

  // persistence list
  const [list, setList] = useState<{ id: string; title: string }[]>([]);
  const [title, setTitle] = useState(initialTitle);

  // instantiate engine once for these props
  const engine = useMemo(() => {
    const adapter = new FastApiAdapter({ baseUrl: BASE });
    return new ConversationEngine({
      initialDoc,
      steps: steps as EngineStep[],
      adapter,
      onCommitted: async () => {
        // refresh list after each commit
        try { setList(await adapter.list().then(items => items.map(i => ({ id: i.id, title: i.title })))); } catch {}
        force();
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialDoc, steps]);

  // preload list
  useEffect(() => {
    (async () => {
      try { setList(await engine.listConversations()); } catch {}
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // scroll to bottom of left pane when commits change
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [engine.committed.length]); // reading getter triggers re-run after force()

  // Actions used by step 1-2 (explicit steps)
  const actions = useMemo<ActionRegistry>(() => ({
    'set-contact-name': (ctx) => [
      ...builtins.ensureObject('/contact')(ctx),
      ...builtins.writeFromVar('name', '/contact/name')(ctx),
    ],

    'create-contact-fields': (ctx) => {
      const wants: string[] = [];
      if (String(ctx.vars.choosePhone || '') === 'Add') wants.push('phone');
      if (String(ctx.vars.chooseEmail || '') === 'Add') wants.push('email');
      if (String(ctx.vars.chooseLink || '') === 'Add') wants.push('link');
      if (String(ctx.vars.chooseLocation || '') === 'Add') wants.push('location');
      return [
        ...builtins.ensureObject('/contact')(ctx),
        ...builtins.ensureKeys('/contact', wants, '')(ctx),
      ];
    },
  }), []);

  // Toolbar handlers
  async function onNew() {
    await engine.newConversation(crypto.randomUUID());
    try { setList(await engine.listConversations()); } catch {}
    setTitle(initialTitle);
    force();
  }
  async function onLoad(id: string) {
    if (!id) return;
    await engine.loadConversation(id);
    // engine.load sets title server-side; we fetch list after load
    try { setList(await engine.listConversations()); } catch {}
    force();
  }
  async function onRename(newTitle: string) {
    setTitle(newTitle);
    await engine.renameConversation(newTitle);
    try { setList(await engine.listConversations()); } catch {}
  }
  async function onUndoLast() {
    await engine.undoLast();
    force();
  }

  // UI flags exactly as before
  const uiFlags = useMemo(() => ({
    showPatchPreview: true,
    showApplyButton: true,
    showCurrentJson: false,
  }), []);

  const curStep = engine.currentStep;

  return (
    <main className="h-[100dvh] overflow-hidden grid grid-cols-2">
      {/* Left: chat column */}
      <div className="border-r border-slate-200 flex flex-col min-h-0">
        {/* History */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-4">
          {engine.committed.length === 0 && (
            <div className="text-slate-500 mt-2">Start with your name, then choose fields.</div>
          )}
          {engine.committed.map((st, i) => {
            const opLines = summarizeOps(st.ops);
            return (
              <div key={i} className="space-y-2">
                <div className="inline-block max-w-[85%] rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2">
                  <div className="text-[12px] text-slate-500 mb-1">
                    {st.mode} • {new Date(st.at).toLocaleTimeString()}
                  </div>
                  {opLines.map((l, idx) => <div key={idx}>{l}</div>)}
                  {i === engine.committed.length - 1 && (
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

        {/* Composer (pinned bottom, scrolls internally if tall) */}
        <div className="border-t border-slate-200 p-3 bg-white shrink-0 pb-[env(safe-area-inset-bottom)]">
          {!curStep ? (
            <div className="text-slate-600">Flow complete.</div>
          ) : (
            <div className="max-h-[45dvh] overflow-y-auto pr-1">
              <Flux4Bots
                template={curStep.template}
                store={engine.store as any}
                mode={curStep.mode}
                actions={curStep.mode === 'explicit' ? actions : undefined}
                ui={uiFlags}
              />
            </div>
          )}
          <div className="text-[12px] text-slate-500 mt-2">Click <b>Apply Patch</b> to commit this step.</div>
        </div>
      </div>

      {/* Right: JSON + controls */}
      <div className="flex flex-col min-h-0">
        <div className="border-b border-slate-200 p-3 flex items-center gap-2">
          <button onClick={onNew} className="px-3 py-2 rounded-lg bg-slate-900 text-white text-sm" type="button">
            + New
          </button>

          <select
            className="px-2 py-2 border border-slate-300 rounded-lg text-sm"
            defaultValue=""
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
          <pre className="bg-slate-50 rounded-lg p-3 min-h-full">{JSON.stringify(engine.currentDoc, null, 2)}</pre>
        </div>
      </div>
    </main>
  );
}
