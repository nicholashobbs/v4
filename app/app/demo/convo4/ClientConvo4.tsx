'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Flux4Bots,
  createResumeActions,
  getResumeSectionSteps,
  ConversationEngine,
  FastApiAdapter,
  builtins,
  applyPatch,
  RESUME_SECTION_CONFIG,
  decodePointerSegment,
  getAtPointer,
} from '../../../lib/flux4bots';
import type { Operation, ActionRegistry, LoadedStep, ResumeSectionKey, CommittedStep } from '../../../lib/flux4bots';
import { sanitizeCustomFieldLabels } from '../../../lib/flux4bots/utils/customFields';

const BASE = process.env.NEXT_PUBLIC_SERVER_BASE_URL ?? 'http://localhost:8000';

function cloneValue<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value));
}

function humanizeKey(input: string): string {
  const cleaned = input.replace(/[_-]+/g, ' ');
  return cleaned.replace(/\b\w/g, char => char.toUpperCase()).trim() || input;
}

function formatList(items: string[]): string {
  if (items.length <= 1) return items.join('');
  const head = items.slice(0, -1).join(', ');
  const tail = items[items.length - 1];
  return `${head} and ${tail}`;
}

function formatValuePreview(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') {
    const trimmed = value.trim();
    const shortened = trimmed.length > 60 ? `${trimmed.slice(0, 57)}…` : trimmed;
    return `"${shortened}"`;
  }
  if (Array.isArray(value)) {
    const joined = value.join(', ');
    return joined.length > 60 ? `${joined.slice(0, 57)}…` : joined;
  }
  if (typeof value === 'object') {
    try {
      const asJson = JSON.stringify(value);
      return asJson.length > 60 ? `${asJson.slice(0, 57)}…` : asJson;
    } catch {
      return '[object]';
    }
  }
  return String(value);
}

const resumeLabelByKey = new Map(RESUME_SECTION_CONFIG.map(item => [item.key, item.label] as const));

type SimpleSkill = { name: string; categories: string[] };

function normalizeSkillEntry(raw: any): SimpleSkill | null {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    return { name: trimmed, categories: [] };
  }
  if (raw && typeof raw === 'object') {
    const obj = raw as { name?: unknown; categories?: unknown };
    const name = typeof obj.name === 'string' ? obj.name.trim() : '';
    if (!name) return null;
    const categoriesRaw: unknown[] = Array.isArray(obj.categories) ? obj.categories : [];
    const categorySet = new Set<string>();
    for (const entry of categoriesRaw) {
      const normalized = String(entry ?? '').trim();
      if (normalized) categorySet.add(normalized);
    }
    return { name, categories: Array.from(categorySet) };
  }
  return null;
}

function normalizeSkillsCollection(source: any): SimpleSkill[] {
  if (!Array.isArray(source)) return [];
  const seen = new Map<string, SimpleSkill>();
  for (const entry of source) {
    const normalized = normalizeSkillEntry(entry);
    if (!normalized) continue;
    const key = normalized.name.toLowerCase();
    seen.set(key, normalized);
  }
  return Array.from(seen.values());
}

function categorizeSentence(categories: string[]): string {
  if (!categories || categories.length === 0) return '';
  return ` (${formatList(categories)})`;
}

function buildFieldDescription(segments: string[]): string {
  if (segments.length === 0) return 'value';
  const segmentToPhrase = (seg: string, idx: number) => {
    if (seg === '-') return 'new item';
    if (/^\d+$/.test(seg)) return `item ${Number(seg) + 1}`;
    const phrase = humanizeKey(seg);
    if (idx === 0) return phrase;
    return phrase.toLowerCase();
  };
  const parts = segments.map(segmentToPhrase);
  if (parts.length === 1) return humanizeKey(segments[0]);
  const [first, ...rest] = parts;
  return `${humanizeKey(first)} ${rest.join(' ')}`.trim();
}

function describeOperationFallback(op: Operation, beforeDoc: any): string {
  const rawSegments = op.path.split('/').slice(1).map(decodePointerSegment);
  const fieldDescription = buildFieldDescription(rawSegments);
  const root = rawSegments[0] ?? '';

  if (root === 'contact') {
    if (rawSegments.length === 1 && (op.op === 'add' || op.op === 'replace')) {
      const value = op.value as Record<string, any> | undefined;
      const detailsEntries = value && typeof value === 'object'
        ? Object.entries(value).filter(([_, v]) => typeof v === 'string' && v !== '')
        : [];
      const nameEntry = detailsEntries.find(([k]) => k === 'name');
      if (nameEntry) {
        const [, nameVal] = nameEntry;
        const sentenceVerb = op.op === 'add' ? 'Added' : 'Updated';
        const prefix = sentenceVerb === 'Added' ? 'Added name' : 'Updated name';
        return `${prefix} "${String(nameVal)}" to contact.`;
      }
      const details = detailsEntries.map(([k, v]) => `${humanizeKey(k)} "${String(v)}"`);
      const summary = details.length > 0 ? ` with ${formatList(details)}` : '';
      const verb = op.op === 'add' ? 'Added' : 'Updated';
      return `${verb} contact${summary}.`;
    }
    if (rawSegments.length === 2 && rawSegments[1] === 'name') {
      if (op.op === 'remove') return 'Removed contact name.';
      const valuePreview = formatValuePreview('value' in op ? op.value : undefined);
      return `Set contact name to ${valuePreview}.`;
    }
  }

  if (op.op === 'remove') {
    const previous = getAtPointer(beforeDoc, op.path);
    const prevPreview = previous ? formatValuePreview(previous) : '';
    return prevPreview
      ? `Removed ${fieldDescription} (${prevPreview}).`
      : `Removed ${fieldDescription}.`;
  }
  const valuePreview = formatValuePreview(op.value);
  if (op.op === 'add') {
    return valuePreview === '—'
      ? `Added ${fieldDescription}.`
      : `Added ${fieldDescription} ${valuePreview}.`;
  }
  return valuePreview === '—'
    ? `Updated ${fieldDescription}.`
    : `Set ${fieldDescription} to ${valuePreview}.`;
}

function buildUserMessages(args: {
  step: CommittedStep;
  beforeDoc: any;
  afterDoc: any;
}): string[] {
  const { step, beforeDoc, afterDoc } = args;
  let messages: string[] = [];

  switch (step.templatePath) {
    case './step1-name.yaml': {
      const beforeName = beforeDoc?.contact?.name ?? '';
      const afterName = afterDoc?.contact?.name ?? '';
      if (afterName && !beforeName) messages = [`Added name "${afterName}" to contact.`];
      else if (afterName && beforeName && afterName !== beforeName) messages = [`Updated contact name to "${afterName}".`];
      else if (!afterName && beforeName) messages = ['Removed contact name.'];
      break;
    }
    case './step2-choose-fields.yaml': {
      const beforeContact = beforeDoc?.contact ?? {};
      const afterContact = afterDoc?.contact ?? {};
      const beforeKeys = new Set(Object.keys(beforeContact).filter(key => key !== 'name'));
      const afterKeys = Object.keys(afterContact).filter(key => key !== 'name');
      const added = afterKeys.filter(key => !beforeKeys.has(key));
      const removed = Array.from(beforeKeys).filter(key => !afterKeys.includes(key));
      const changes: string[] = [];
      for (const key of added) changes.push(`Added ${humanizeKey(key)} field to contact.`);
      for (const key of removed) changes.push(`Removed ${humanizeKey(key)} field from contact.`);
      if (changes.length === 0 && afterKeys.length === 0) changes.push('No contact fields selected.');
      messages = changes;
      break;
    }
    case './step3-fill-chosen.yaml': {
      const beforeContact = beforeDoc?.contact ?? {};
      const afterContact = afterDoc?.contact ?? {};
      const keys = new Set([
        ...Object.keys(beforeContact),
        ...Object.keys(afterContact),
      ]);
      keys.delete('name');
      const changes: string[] = [];
      for (const key of keys) {
        const beforeVal = beforeContact[key] ?? '';
        const afterVal = afterContact[key] ?? '';
        if (beforeVal === afterVal) continue;
        const label = humanizeKey(key);
        if (afterVal === '') {
          changes.push(`Cleared ${label} field.`);
        } else if (!beforeVal) {
          changes.push(`Added "${afterVal}" to ${label} field.`);
        } else {
          changes.push(`Updated ${label} field to "${afterVal}".`);
        }
      }
      messages = changes;
      break;
    }
    case './step4-create-sections.yaml': {
      const beforeResume = beforeDoc?.resume ?? {};
      const afterResume = afterDoc?.resume ?? {};
      const beforeKeys = new Set(Object.keys(beforeResume));
      const afterKeys = Object.keys(afterResume);
      const added = afterKeys.filter(key => !beforeKeys.has(key));
      const removed = Array.from(beforeKeys).filter(key => !afterKeys.includes(key));
      const addedLabels = added.map(key => resumeLabelByKey.get(key as any) ?? humanizeKey(key));
      const removedLabels = removed.map(key => resumeLabelByKey.get(key as any) ?? humanizeKey(key));

      if (addedLabels.length > 0) {
        messages.push(`Added resume sections: ${formatList(addedLabels)}.`);
      }
      if (removedLabels.length > 0) {
        messages.push(`Removed resume sections: ${formatList(removedLabels)}.`);
      }
      if (messages.length === 0) {
        if (afterKeys.length === 0) {
          messages.push('No resume sections selected.');
        } else {
          messages.push('Kept existing resume sections.');
        }
      }
      break;
    }
    case './step5-section-hub.yaml': {
      messages = ['Selected the next resume section to continue.'];
      break;
    }
    case '@resume/skills': {
      const beforeSkills = normalizeSkillsCollection(beforeDoc?.resume?.skills ?? []);
      const afterSkills = normalizeSkillsCollection(afterDoc?.resume?.skills ?? []);
      const beforeMap = new Map(beforeSkills.map(skill => [skill.name.toLowerCase(), skill]));
      const afterMap = new Map(afterSkills.map(skill => [skill.name.toLowerCase(), skill]));
      const changes: string[] = [];

      for (const [key, skill] of afterMap.entries()) {
        const prev = beforeMap.get(key);
        if (!prev) {
          const categoryNote = categorizeSentence(skill.categories);
          changes.push(`Added skill ${skill.name}${categoryNote}.`);
          continue;
        }
        const addedCats = skill.categories.filter(cat => !prev.categories.some(prevCat => prevCat.toLowerCase() === cat.toLowerCase()));
        const removedCats = prev.categories.filter(cat => !skill.categories.some(nextCat => nextCat.toLowerCase() === cat.toLowerCase()));
        if (addedCats.length === 0 && removedCats.length === 0) continue;
        if (addedCats.length > 0) {
          changes.push(`Added categories ${formatList(addedCats)} to ${skill.name}.`);
        }
        if (removedCats.length > 0) {
          changes.push(`Removed categories ${formatList(removedCats)} from ${skill.name}.`);
        }
      }

      for (const [key, skill] of beforeMap.entries()) {
        if (!afterMap.has(key)) {
          const categoryNote = categorizeSentence(skill.categories);
          changes.push(`Removed skill ${skill.name}${categoryNote}.`);
        }
      }

      messages = changes.length > 0 ? changes : ['Reviewed skills.'];
      break;
    }
    case '@resume/experience': {
      const beforeEntries = Array.isArray(beforeDoc?.resume?.experience) ? beforeDoc.resume.experience : [];
      const afterEntries = Array.isArray(afterDoc?.resume?.experience) ? afterDoc.resume.experience : [];
      if (afterEntries.length === 0) {
        messages = ['No experience items recorded.'];
        break;
      }
      const header = afterEntries.length > beforeEntries.length ? 'Added experience items:' : 'Updated experience items:';
      const bullets: string[] = [header];
      afterEntries.forEach((entry: any, idx: number) => {
        if (!entry || typeof entry !== 'object') {
          bullets.push(`- Item ${idx + 1}: no details provided.`);
          return;
        }
        const parts: string[] = [];
        const pushPart = (label: string, value: unknown) => {
          if (typeof value === 'string' && value.trim() !== '') {
            parts.push(`${label} "${value.trim()}"`);
          } else if (Array.isArray(value) && value.length > 0) {
            const joined = value.map(item => String(item).trim()).filter(Boolean).join('; ');
            if (joined) parts.push(`${label} ${joined}`);
          }
        };
        pushPart('title', entry.title);
        pushPart('institution', entry.institution);
        pushPart('location', entry.location);
        pushPart('start date', entry.startDate);
        pushPart('end date', entry.endDate);
        pushPart('bullets', entry.bullets);
        const detail = parts.length > 0 ? parts.join(', ') : 'no details provided';
        bullets.push(`- Item ${idx + 1}: ${detail}.`);
      });
      messages = bullets;
      break;
    }
    case '@resume/summary': {
      const summary = typeof afterDoc?.resume?.summary === 'string' ? afterDoc.resume.summary.trim() : '';
      messages = summary
        ? [`Set resume summary to "${summary}".`]
        : ['Cleared resume summary.'];
      break;
    }
    default: {
      const fallbackMessages = step.ops.map(op => describeOperationFallback(op, beforeDoc));
      messages = fallbackMessages;
    }
  }

  return messages.length > 0 ? messages : ['No changes recorded.'];
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

  const initialDocSnapshot = useMemo(() => cloneValue(initialDoc ?? {}), [initialDoc]);

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

    type CustomFieldEntry = { label: string; slug: string };
    const CUSTOM_FIELD_STATE = 'contact.customFieldEntries';

    const ensureUniqueSlug = (
      ctx: Parameters<ActionRegistry[string]>[0],
      base: string,
      taken: Set<string>,
      prevBySlug: Map<string, CustomFieldEntry>,
      prefer?: string | null,
    ) => {
      const encode = ctx.helpers.encode;
      if (prefer && !taken.has(prefer)) {
        taken.add(prefer);
        return prefer;
      }

      const normalizedBase = base || 'field';
      let slug = normalizedBase;
      let counter = 2;
      while (taken.has(slug) || (ctx.helpers.get(ctx.doc, `/contact/${encode(slug)}`) !== undefined && !prevBySlug.has(slug))) {
        slug = `${normalizedBase}-${counter++}`;
      }
      taken.add(slug);
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
        const selected = Array.from(new Set(selectedArray.map((val: any) => String(val)))).filter(v => v !== 'custom');

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

        const customLabels = sanitizeCustomFieldLabels(ctx.vars.customContactField, 8);
        const prevEntriesRaw = ctx.runtime.getState?.(CUSTOM_FIELD_STATE);
        const prevEntries: CustomFieldEntry[] = Array.isArray(prevEntriesRaw)
          ? prevEntriesRaw.filter((entry): entry is CustomFieldEntry => (
              entry && typeof entry.label === 'string' && typeof entry.slug === 'string'
            ))
          : [];

        const prevByLabel = new Map(prevEntries.map(entry => [entry.label.toLowerCase(), entry]));
        const prevBySlug = new Map(prevEntries.map(entry => [entry.slug, entry]));
        const takenSlugs = new Set<string>(Object.values(builtinMap));

        const nextEntries: CustomFieldEntry[] = [];
        for (const label of customLabels) {
          const lower = label.toLowerCase();
          const prev = prevByLabel.get(lower);
          const baseSlug = slugify(label);
          const slug = ensureUniqueSlug(ctx, baseSlug, takenSlugs, prevBySlug, prev?.slug);
          nextEntries.push({ label, slug });
        }

        const nextSlugs = new Set(nextEntries.map(entry => entry.slug));
        for (const entry of prevEntries) {
          if (!nextSlugs.has(entry.slug)) {
            const path = `/contact/${encode(entry.slug)}`;
            if (ctx.helpers.get(ctx.doc, path) !== undefined) {
              ops.push({ op: 'remove', path });
            }
          }
        }

        for (const entry of nextEntries) {
          const path = `/contact/${encode(entry.slug)}`;
          if (ctx.helpers.get(ctx.doc, path) === undefined) {
            ops.push({ op: 'add', path, value: '' });
          }
        }

        ctx.runtime.setState?.(CUSTOM_FIELD_STATE, nextEntries);

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
  const committedSteps = engine.committed;

  const historyEntries = useMemo(() => {
    const entries: Array<{
      step: CommittedStep;
      botText: string;
      userLines: string[];
      timeLabel: string;
    }> = [];
    let workingDoc = cloneValue(initialDocSnapshot ?? {});

    for (const step of committedSteps) {
      const beforeDoc = cloneValue(workingDoc ?? {});
      const afterDoc = step.ops.length > 0 ? applyPatch(beforeDoc, step.ops) : cloneValue(beforeDoc ?? {});
      const templateNameRaw = stepCatalog[step.templatePath]?.template.name ?? step.templatePath;
      const botText = templateNameRaw.replace(/—/g, '-');
      const userLines = buildUserMessages({ step, beforeDoc, afterDoc });
      const timeLabel = new Date(step.at).toLocaleTimeString();

      entries.push({ step, botText, userLines, timeLabel });
      workingDoc = afterDoc;
    }

    return entries;
  }, [committedSteps, initialDocSnapshot, stepCatalog]);
  const stepAutoCommit = curStep?.template.meta?.autoCommit ?? false;

  return (
    <main className="h-[100dvh] overflow-hidden grid grid-cols-2 bg-[var(--f4b-bg)] text-[var(--f4b-text-primary)]">
      {/* Left: chat column */}
      <div className="border-r border-[var(--f4b-border)] flex flex-col min-h-0 bg-[var(--f4b-surface-muted)]">
        {/* History */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-5">
          {historyEntries.length === 0 && (
            <div className="text-[var(--f4b-text-muted)] mt-2">Start with your name, then choose fields.</div>
          )}
          {historyEntries.map((entry, index) => (
            <div key={`${entry.step.at}-${index}`} className="space-y-2">
              <div className="flex justify-start">
                <div className="max-w-[75%] min-w-[200px] rounded-xl border border-[var(--f4b-border-muted)] bg-[var(--f4b-surface-soft)] px-3 py-2 shadow-sm">
                  <div className="text-[12px] text-[var(--f4b-text-muted)] mb-1">Bot • {entry.timeLabel}</div>
                  <div className="text-sm font-medium text-[var(--f4b-text-primary)]">{entry.botText}</div>
                </div>
              </div>
              <div className="flex justify-end">
                <div className="max-w-[75%] min-w-[200px] rounded-xl border border-[var(--f4b-border)] bg-[var(--f4b-surface)] px-3 py-2">
                  <div className="text-[12px] text-[var(--f4b-text-muted)] mb-1">You • {entry.timeLabel}</div>
                  {entry.userLines.map((line, idx) => (
                    <div key={idx} className="text-sm leading-snug text-[var(--f4b-text-primary)]">
                      {line}
                    </div>
                  ))}
                  {index === historyEntries.length - 1 && (
                    <div className="mt-2">
                      <button className="text-[12px] text-[var(--f4b-accent)] underline" onClick={onUndoLast} type="button">
                        Undo
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
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
          {curStep && !stepAutoCommit && (
            <div className="text-[12px] text-[var(--f4b-text-muted)] mt-2">
              Click <b>Apply Patch</b> to commit this step.
            </div>
          )}
          {curStep && stepAutoCommit && (
            <div className="text-[12px] text-[var(--f4b-text-muted)] mt-2">
              Changes save automatically for this step.
            </div>
          )}
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
