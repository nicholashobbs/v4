'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Flux4Bots,
  createResumeActions,
  getResumeSectionSteps,
  ConversationEngine,
  FastApiAdapter,
  builtins,
} from '../../../lib/flux4bots';
import type { Operation, ActionRegistry, LoadedStep, ResumeSectionKey } from '../../../lib/flux4bots';

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
  // UI refresh hooks
  const [, setRenderTick] = useState(0);
  const [storeVersion, setStoreVersion] = useState(0);
  const force = (opts?: { refreshStore?: boolean }) => {
    setRenderTick(x => x + 1);
    if (opts?.refreshStore) setStoreVersion(v => v + 1);
  };

  // persistence list
  const [list, setList] = useState<{ id: string; title: string }[]>([]);
  const [title, setTitle] = useState(initialTitle);
  const [draftTitle, setDraftTitle] = useState(initialTitle);
  const [currentId, setCurrentId] = useState<string>(''); // NEW: track active UUID for Load menu

  const resumeSectionSteps = useMemo(() => getResumeSectionSteps(), []);
  const stepCatalog = useMemo<Record<string, LoadedStep>>(() => {
    const catalog: Record<string, LoadedStep> = {};
    for (const step of steps) {
      catalog[step.templatePath] = step;
    }
    for (const step of Object.values(resumeSectionSteps)) {
      catalog[step.templatePath] = step;
    }
    return catalog;
  }, [steps, resumeSectionSteps]);

  // instantiate engine once for these props
  const engine = useMemo(() => {
    const adapter = new FastApiAdapter({ baseUrl: BASE }); // typed ctor
    return new ConversationEngine({
      initialDoc,
      steps,
      adapter,
      catalog: stepCatalog,
      onCommitted: async () => {
        // refresh list after each commit
        try {
          const items = await adapter.list();
          setList(items.map(i => ({ id: i.id, title: i.title })));
        } catch {}
        force();
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialDoc, steps, stepCatalog]);

  // keep currentId synced with engine's active conversation (including lazy creation on first save)
  useEffect(() => {
    setCurrentId(engine.conversationId ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine.committed.length]);

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

  const hubStep = useMemo(() => (steps.length > 0 ? steps[steps.length - 1] : null), [steps]);

  const contactActions = useMemo<ActionRegistry>(() => {
    const slugify = (input: string) => {
      return input
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'field';
    };

    const CUSTOM_FIELD_STATE = 'contact.customFieldSlug';

    const uniqueContactKey = (ctx: Parameters<ActionRegistry[string]>[0], base: string, prefer?: string | null) => {
      if (prefer) return prefer;
      const encode = ctx.helpers.encode;
      let slug = base || 'field';
      let counter = 2;
      while (ctx.helpers.get(ctx.doc, `/contact/${encode(slug)}`) !== undefined) {
        slug = `${base || 'field'}-${counter++}`;
      }
      return slug;
    };

    return {
      'set-contact-name': (ctx) => [
        ...builtins.ensureObject('/contact')(ctx),
        ...builtins.writeFromVar('name', '/contact/name')(ctx),
      ],

      'create-contact-fields': (ctx) => {
        const rawSelection = ctx.vars.contactFields;
        const selectedArray = Array.isArray(rawSelection)
          ? rawSelection
          : rawSelection != null
            ? [rawSelection]
            : [];
        const selected = Array.from(new Set(selectedArray.map((val: any) => String(val))));

        const builtinMap: Record<string, string> = {
          phone: 'phone',
          email: 'email',
          link: 'link',
          location: 'location',
        };

        const builtinKeys = selected
          .map(key => builtinMap[key])
          .filter((key): key is string => Boolean(key));

        const ops: Operation[] = [
          ...builtins.ensureObject('/contact')(ctx),
          ...builtins.ensureKeys('/contact', builtinKeys, '')(ctx),
        ];

        // Remove built-in fields that were unselected
        const encode = ctx.helpers.encode;
        for (const key of Object.values(builtinMap)) {
          if (!builtinKeys.includes(key)) {
            const path = `/contact/${encode(key)}`;
            if (ctx.helpers.get(ctx.doc, path) !== undefined) {
              ops.push({ op: 'remove', path });
            }
          }
        }

        const prevSlug = ctx.runtime.getState?.(CUSTOM_FIELD_STATE) as string | undefined;
        if (!selected.includes('custom') && prevSlug) {
          const prevPath = `/contact/${ctx.helpers.encode(prevSlug)}`;
          if (ctx.helpers.get(ctx.doc, prevPath) !== undefined) {
            ops.push({ op: 'remove', path: prevPath });
          }
          ctx.runtime.setState?.(CUSTOM_FIELD_STATE, undefined as any);
        }

        if (selected.includes('custom')) {
          const label = String(ctx.vars.customContactField ?? '').trim();
          const baseSlug = slugify(label);

          if (prevSlug && (!label || baseSlug !== prevSlug)) {
            const prevPath = `/contact/${ctx.helpers.encode(prevSlug)}`;
            if (ctx.helpers.get(ctx.doc, prevPath) !== undefined) {
              ops.push({ op: 'remove', path: prevPath });
            }
            ctx.runtime.setState?.(CUSTOM_FIELD_STATE, undefined as any);
          }

          if (label) {
            const slug = uniqueContactKey(ctx, baseSlug, prevSlug);
            const path = `/contact/${ctx.helpers.encode(slug)}`;
            const exists = ctx.helpers.get(ctx.doc, path) !== undefined;
            ops.push({ op: exists ? 'replace' : 'add', path, value: '' });
            ctx.runtime.setState?.(CUSTOM_FIELD_STATE, slug);
          }
        }

        return ops;
      },
    };
  }, []);

  const resumeActions = useMemo<ActionRegistry>(
    () => createResumeActions({
      runtime: engine.runtime,
      hubStep,
      sectionSteps: resumeSectionSteps,
    }),
    [engine, hubStep, resumeSectionSteps],
  );

  const actions = useMemo<ActionRegistry>(() => ({
    ...resumeActions,
    ...contactActions,
  }), [resumeActions, contactActions]);

  // Toolbar handlers
  async function onNew() {
    await engine.newConversation(crypto.randomUUID());
    try { setList(await engine.listConversations()); } catch {}
    setTitle(initialTitle);
    setDraftTitle(initialTitle);
    setCurrentId(engine.conversationId ?? ''); // NEW: keep Load select in sync
    force({ refreshStore: true });
  }
  async function onLoad(id: string) {
    if (!id) return;
    const loaded = await engine.loadConversation(id);
    // engine.load sets title server-side; we fetch list after load
    try { setList(await engine.listConversations()); } catch {}
    if (loaded) {
      setTitle(loaded.title);
      setDraftTitle(loaded.title);
      setCurrentId(loaded.id);
    } else {
      setCurrentId('');
    }
    force({ refreshStore: true });
  }
  async function onRenameSubmit() {
    const trimmed = draftTitle.trim();
    if (!trimmed) return;
    await engine.renameConversation(trimmed);
    setTitle(trimmed);
    setDraftTitle(trimmed);
    setCurrentId(engine.conversationId ?? '');
    try { setList(await engine.listConversations()); } catch {}
  }
  async function onUndoLast() {
    await engine.undoLast();
    setCurrentId(engine.conversationId ?? ''); // NEW
    force({ refreshStore: true });
  }

  // UI flags exactly as before
  const uiFlags = useMemo(() => ({
    showPatchPreview: true,
    showApplyButton: true,
    showCurrentJson: false,
  }), []);

  const curStep = engine.currentStep;

  return (
    <main className="h-[100dvh] overflow-hidden grid grid-cols-2 bg-[var(--f4b-bg)] text-[var(--f4b-text-primary)]">
      {/* Left: chat column */}
      <div className="border-r border-[var(--f4b-border)] flex flex-col min-h-0 bg-[var(--f4b-surface-muted)]">
        {/* History */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-4">
          {engine.committed.length === 0 && (
            <div className="text-[var(--f4b-text-muted)] mt-2">Start with your name, then choose fields.</div>
          )}
          {engine.committed.map((st, i) => {
            const opLines = summarizeOps(st.ops);
            return (
              <div key={i} className="space-y-2">
                <div className="inline-block max-w-[85%] rounded-xl border border-[var(--f4b-border)] bg-[var(--f4b-surface)] px-3 py-2">
                  <div className="text-[12px] text-[var(--f4b-text-muted)] mb-1">
                    {st.mode} • {new Date(st.at).toLocaleTimeString()}
                  </div>
                  {opLines.map((l, idx) => <div key={idx}>{l}</div>)}
                  {i === engine.committed.length - 1 && (
                    <div className="mt-2">
                      <button className="text-[12px] text-[var(--f4b-accent)] underline" onClick={onUndoLast} type="button">
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
        <div className="border-t border-[var(--f4b-border)] p-3 bg-[var(--f4b-surface)] shrink-0 pb-[env(safe-area-inset-bottom)]">
          {!curStep ? (
            <div className="text-[var(--f4b-text-secondary)]">Flow complete.</div>
          ) : (
            <div className="max-h-[45dvh] overflow-y-auto pr-1">
              <Flux4Bots
                key={storeVersion}
                template={curStep.template}
                store={engine.store as any}
                mode={curStep.mode}
                actions={actions}
                runtime={engine.runtime}
                ui={uiFlags}
              />
            </div>
          )}
          <div className="text-[12px] text-[var(--f4b-text-muted)] mt-2">
            Click <b>Apply Patch</b> to commit this step.
          </div>
        </div>
      </div>

      {/* Right: JSON + controls */}
      <div className="flex flex-col min-h-0 bg-[var(--f4b-surface-muted)]">
        <div className="border-b border-[var(--f4b-border)] p-3 flex items-center gap-2 bg-[var(--f4b-surface)]">
          <button
            onClick={onNew}
            className="px-3 py-2 rounded-lg bg-[var(--f4b-accent)] text-[#0f1422] text-sm font-semibold"
            type="button"
          >
            + New
          </button>

          <select
            className="px-2 py-2 border border-[var(--f4b-border)] rounded-lg text-sm bg-[var(--f4b-input-bg)] text-[var(--f4b-input-text)]"
            value={currentId}                            
            onChange={e => onLoad(e.target.value)}
          >
            <option value="" disabled>Load…</option>
            {list.map(item => (
              <option key={item.id} value={item.id}>
                {item.title} • {item.id}                
              </option>
            ))}
          </select>

          <div className="ml-auto flex items-center gap-2">
            <span className="text-[12px] text-[var(--f4b-text-muted)]">Rename:</span>
            <input
              className="px-2 py-2 border border-[var(--f4b-border)] rounded-lg text-sm min-w-[220px] bg-[var(--f4b-input-bg)] text-[var(--f4b-input-text)]"
              value={draftTitle}
              onChange={e => setDraftTitle(e.target.value)}
            />
            <button
              className="px-3 py-2 rounded-lg border border-[var(--f4b-border)] text-sm bg-[var(--f4b-surface-soft)]"
              type="button"
              onClick={onRenameSubmit}
              disabled={!currentId}
            >
              Save name
            </button>
            <span className="text-[12px] text-[var(--f4b-text-muted)]">Saved: {title}</span>
            <span className="text-[12px] text-[var(--f4b-text-muted)] opacity-70">ID: {currentId || '—'}</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          <pre className="rounded-lg p-3 min-h-full border border-[var(--f4b-border-muted)] bg-[var(--f4b-code-bg)] text-[var(--f4b-text-secondary)]">
            {JSON.stringify(engine.currentDoc, null, 2)}
          </pre>
        </div>
      </div>
    </main>
  );
}
