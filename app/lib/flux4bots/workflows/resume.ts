import { decodePointerSegment, encodePointerSegment } from '../core/pointer';
import type {
  ActionRegistry,
  ActionRuntime,
  LoadedStep,
  Operation,
  Template,
  StepMode,
} from '../types';

export type ResumeSectionKey = 'experience' | 'education' | 'skills' | 'summary';

type SectionKind = 'collection' | 'skills' | 'summary';

type ResumeSectionDefinition = {
  key: ResumeSectionKey;
  label: string;
  kind: SectionKind;
  mode: StepMode;
};

type SectionStatus = 'todo' | 'in-progress' | 'done';

type ResumeSession = {
  activeSection: ResumeSectionKey | null;
  statuses: Partial<Record<ResumeSectionKey, SectionStatus>>;
};

const SECTION_DEFINITIONS: Record<ResumeSectionKey, ResumeSectionDefinition> = {
  experience: { key: 'experience', label: 'Experience', kind: 'collection', mode: 'diff' },
  education: { key: 'education', label: 'Education', kind: 'collection', mode: 'diff' },
  skills: { key: 'skills', label: 'Skills', kind: 'skills', mode: 'explicit' },
  summary: { key: 'summary', label: 'Summary', kind: 'summary', mode: 'diff' },
};

const SECTION_KEYS = Object.keys(SECTION_DEFINITIONS) as ResumeSectionKey[];
const SESSION_KEY = 'resumeState';

export const RESUME_SECTION_CONFIG = Object.values(SECTION_DEFINITIONS).map(({ key, label }) => ({ key, label }));

const SECTION_TEMPLATES: Record<ResumeSectionKey, LoadedStep> = {
  experience: buildCollectionStep(SECTION_DEFINITIONS.experience),
  education: buildCollectionStep(SECTION_DEFINITIONS.education),
  skills: buildSkillsStep(SECTION_DEFINITIONS.skills),
  summary: buildSummaryStep(SECTION_DEFINITIONS.summary),
};

export function getResumeSectionSteps(): Record<ResumeSectionKey, LoadedStep> {
  return Object.fromEntries(
    Object.entries(SECTION_TEMPLATES).map(([key, step]) => [key, cloneLoadedStep(step)]),
  ) as Record<ResumeSectionKey, LoadedStep>;
}

export function createResumeActions(args: {
  runtime: ActionRuntime;
  hubStep: LoadedStep | null;
  sectionSteps: Record<ResumeSectionKey, LoadedStep>;
}): ActionRegistry {
  const { runtime, hubStep, sectionSteps } = args;

  const actions: ActionRegistry = {};

  actions['resume.init-sections'] = (ctx) => {
    const selected = coerceSectionSelection(ctx.vars.resumeSections);
    const selectedSet = new Set<ResumeSectionKey>(selected);
    const ops: Operation[] = [];

    const resumePtr = '/resume';
    const resumeValue = ctx.helpers.get(ctx.doc, resumePtr);
    const resumeIsObject = resumeValue && typeof resumeValue === 'object' && !Array.isArray(resumeValue);

    if (selected.length === 0) {
      if (resumeValue !== undefined) {
        ops.push({ op: 'remove', path: resumePtr });
      }
      ctx.runtime.setState?.(SESSION_KEY, defaultSession());
      return ops;
    }

    if (resumeValue === undefined) {
      ops.push({ op: 'add', path: resumePtr, value: {} });
    } else if (!resumeIsObject) {
      ops.push({ op: 'replace', path: resumePtr, value: {} });
    }

    const encode = ctx.helpers.encode;
    const existingKeys: string[] = resumeIsObject ? Object.keys(resumeValue) : [];
    if (resumeIsObject) {
      for (const key of existingKeys) {
        if (!selected.includes(key as ResumeSectionKey)) {
          ops.push({ op: 'remove', path: `${resumePtr}/${encode(key)}` });
        }
      }
    }

    for (const key of selected) {
      const def = SECTION_DEFINITIONS[key];
      if (!def) continue;
      const basePath = `${resumePtr}/${encode(key)}`;
      const current = ctx.helpers.get(ctx.doc, basePath);

      if (def.kind === 'collection') {
        ops.push(...ensureArray(basePath, current));
      } else if (def.kind === 'skills') {
        ops.push(...ensureArray(basePath, current));
      } else if (def.kind === 'summary') {
        ops.push(...ensureString(basePath, current));
      }
    }

    writeSession(ctx, (draft) => {
      for (const key of SECTION_KEYS) {
        if (selectedSet.has(key)) {
          if (!draft.statuses[key]) draft.statuses[key] = 'todo';
        } else {
          delete draft.statuses[key];
        }
      }
      if (draft.activeSection && !selectedSet.has(draft.activeSection)) {
        draft.activeSection = null;
      }
    });

    return ops;
  };

  actions['resume.choose-section'] = (ctx) => {
    const pointerRaw = ctx.vars.sectionPicker;
    const pointer = Array.isArray(pointerRaw) ? pointerRaw[0] : pointerRaw;
    if (typeof pointer !== 'string' || !pointer.startsWith('/resume/')) return [];

    const segments = pointer.split('/').slice(2);
    if (segments.length === 0) return [];

    const key = decodePointerSegment(segments[0]) as ResumeSectionKey;
    if (!SECTION_DEFINITIONS[key]) return [];

    const stepForSection = sectionSteps[key];
    if (!stepForSection || !hubStep) return [];

    const nextSteps = [stepForSection, hubStep];
    writeSession(ctx, (draft) => {
      draft.activeSection = key;
      if (draft.statuses[key] !== 'done') {
        draft.statuses[key] = 'in-progress';
      }
    });
    // Complete the hub step before queueing follow-up steps so the new section
    // becomes the active step immediately (avoids needing a second click).
    ctx.runtime.completeStep?.();
    runtime.enqueueSteps(nextSteps);
    return [];
  };

  for (const def of Object.values(SECTION_DEFINITIONS)) {
    const basePath = `/resume/${encodePointerSegment(def.key)}`;

    if (def.kind === 'collection') {
      actions[`resume.collection.add.${def.key}`] = (ctx) => {
        const ops: Operation[] = [];
        const current = ctx.helpers.get(ctx.doc, basePath);
        if (!Array.isArray(current)) {
          ops.push({ op: current === undefined ? 'add' : 'replace', path: basePath, value: [] });
        }
        ops.push({ op: 'add', path: `${basePath}/-`, value: blankCollectionEntry() });
        writeSession(ctx, (draft) => {
          draft.activeSection = def.key;
          if (draft.statuses[def.key] !== 'done') {
            draft.statuses[def.key] = 'in-progress';
          }
        });
        return ops;
      };

      actions[`resume.collection.finish.${def.key}`] = (ctx) => {
        const ops = commitWorkingValue(ctx, basePath, []);
        writeSession(ctx, (draft) => {
          draft.statuses[def.key] = 'done';
          if (draft.activeSection === def.key) {
            draft.activeSection = null;
          }
        });
        return ops;
      };
    }

    if (def.kind === 'skills') {
      actions['resume.skills.save'] = (ctx) => {
        const raw = String(ctx.vars.skillsInput ?? '').trim();
        const values = raw === ''
          ? []
          : raw
              .split(/[,\n]/)
              .map(token => token.trim())
              .filter(Boolean);
        const exists = ctx.helpers.get(ctx.doc, basePath) !== undefined;
        writeSession(ctx, (draft) => {
          draft.activeSection = def.key;
          if (draft.statuses[def.key] !== 'done') {
            draft.statuses[def.key] = 'in-progress';
          }
        });
        return [{ op: exists ? 'replace' : 'add', path: basePath, value: values }];
      };

      actions['resume.skills.finish'] = (ctx) => {
        const ops = commitWorkingValue(ctx, basePath, []);
        writeSession(ctx, (draft) => {
          draft.statuses[def.key] = 'done';
          if (draft.activeSection === def.key) {
            draft.activeSection = null;
          }
        });
        return ops;
      };
    }

    if (def.kind === 'summary') {
      actions['resume.summary.finish'] = (ctx) => {
        const ops = commitWorkingValue(ctx, basePath, '');
        writeSession(ctx, (draft) => {
          draft.statuses[def.key] = 'done';
          if (draft.activeSection === def.key) {
            draft.activeSection = null;
          }
        });
        return ops;
      };
    }
  }

  return actions;
}

/* ----------------------- helpers ----------------------- */
function coerceSectionSelection(raw: any): ResumeSectionKey[] {
  const arr = Array.isArray(raw)
    ? raw
    : raw != null
      ? [raw]
      : [];
  const ordered: ResumeSectionKey[] = [];
  for (const entry of arr) {
    const key = String(entry) as ResumeSectionKey;
    if (SECTION_DEFINITIONS[key] && !ordered.includes(key)) {
      ordered.push(key);
    }
  }
  return ordered;
}

function ensureArray(path: string, current: any): Operation[] {
  if (Array.isArray(current)) return [];
  return [{ op: current === undefined ? 'add' : 'replace', path, value: [] }];
}

function ensureString(path: string, current: any): Operation[] {
  if (typeof current === 'string') return [];
  return [{ op: current === undefined ? 'add' : 'replace', path, value: '' }];
}

function blankCollectionEntry() {
  return {
    title: '',
    institution: '',
    location: '',
    startDate: '',
    endDate: '',
    bullets: '',
  };
}

function commitWorkingValue(ctx: Parameters<ActionRegistry[string]>[0], path: string, fallback: any): Operation[] {
  const workingValue = ctx.helpers.get(ctx.working, path);
  const normalized = workingValue === undefined ? fallback : workingValue;
  const cloned = JSON.parse(JSON.stringify(normalized));
  const exists = ctx.helpers.get(ctx.doc, path) !== undefined;
  return [{ op: exists ? 'replace' : 'add', path, value: cloned }];
}

function defaultSession(): ResumeSession {
  return { activeSection: null, statuses: {} };
}

function sanitizeSession(raw: any): ResumeSession {
  const base = defaultSession();
  if (!raw || typeof raw !== 'object') return base;
  const active = (raw as any).activeSection;
  if (typeof active === 'string' && SECTION_KEYS.includes(active as ResumeSectionKey)) {
    base.activeSection = active as ResumeSectionKey;
  }
  const rawStatuses = (raw as any).statuses;
  if (rawStatuses && typeof rawStatuses === 'object') {
    const statuses: Partial<Record<ResumeSectionKey, SectionStatus>> = {};
    for (const key of SECTION_KEYS) {
      const status = rawStatuses[key];
      if (status === 'todo' || status === 'in-progress' || status === 'done') {
        statuses[key] = status;
      }
    }
    base.statuses = statuses;
  }
  return base;
}

function writeSession(
  ctx: Parameters<ActionRegistry[string]>[0],
  mutate: (draft: ResumeSession) => void,
) {
  const setState = ctx.runtime.setState;
  if (!setState) return;
  const getState = ctx.runtime.getState;
  const currentRaw = getState ? getState<ResumeSession>(SESSION_KEY) : undefined;
  const current = sanitizeSession(currentRaw);
  const draft: ResumeSession = {
    activeSection: current.activeSection,
    statuses: { ...current.statuses },
  };
  mutate(draft);
  setState(SESSION_KEY, sanitizeSession(draft));
}

function buildCollectionStep(def: ResumeSectionDefinition): LoadedStep {
  const basePtr = `/resume/${encodePointerSegment(def.key)}`;
  const template: Template = {
    version: 1,
    name: `Resume — ${def.label}`,
    widgets: [
      {
        id: 'entries',
        type: 'list',
        label: `${def.label} Entries`,
        binding: { path: basePtr },
        item: {
          expandable: true,
          fields: [
            { id: 'title', type: 'text', label: 'Title', binding: { path: '/title' } },
            { id: 'institution', type: 'text', label: 'Institution', binding: { path: '/institution' } },
            { id: 'location', type: 'text', label: 'Location', binding: { path: '/location' } },
            { id: 'startDate', type: 'text', label: 'Start Date', binding: { path: '/startDate' } },
            { id: 'endDate', type: 'text', label: 'End Date', binding: { path: '/endDate' } },
            { id: 'bullets', type: 'text', label: 'Bullets (comma or newline separated)', binding: { path: '/bullets' } },
          ],
        },
      },
      {
        id: 'add',
        type: 'action',
        label: `Add another ${def.label.toLowerCase()} entry`,
        options: { action: `resume.collection.add.${def.key}` },
      },
      {
        id: 'done',
        type: 'action',
        label: 'Done',
        options: { action: `resume.collection.finish.${def.key}` },
      },
    ],
    layout: {
      type: 'vertical',
      children: ['entries', 'add', 'done'],
    },
  };

  return {
    templatePath: `@resume/${def.key}`,
    mode: def.mode,
    template,
  };
}

function buildSkillsStep(def: ResumeSectionDefinition): LoadedStep {
  const basePtr = `/resume/${encodePointerSegment(def.key)}`;
  const template: Template = {
    version: 1,
    name: 'Resume — Skills',
    widgets: [
      {
        id: 'skillsPreview',
        type: 'list',
        label: 'Current Skills',
        binding: { path: basePtr },
        item: {
          expandable: false,
          fields: [
            { id: 'skill', type: 'text', label: 'Skill', binding: { path: '' }, options: { readOnly: true } },
          ],
        },
      },
      {
        id: 'skillsInput',
        type: 'text',
        label: 'Add or replace skills (comma or newline separated)',
      },
      {
        id: 'saveSkills',
        type: 'action',
        label: 'Save skills list',
        options: { action: 'resume.skills.save' },
      },
      {
        id: 'done',
        type: 'action',
        label: 'Done',
        options: { action: 'resume.skills.finish' },
      },
    ],
    layout: {
      type: 'vertical',
      children: ['skillsPreview', 'skillsInput', 'saveSkills', 'done'],
    },
  };

  return {
    templatePath: `@resume/${def.key}`,
    mode: def.mode,
    template,
  };
}

function buildSummaryStep(def: ResumeSectionDefinition): LoadedStep {
  const basePtr = `/resume/${encodePointerSegment(def.key)}`;
  const template: Template = {
    version: 1,
    name: 'Resume — Summary',
    widgets: [
      {
        id: 'summary',
        type: 'text',
        label: 'Summary',
        binding: { path: basePtr },
      },
      {
        id: 'done',
        type: 'action',
        label: 'Done',
        options: { action: 'resume.summary.finish' },
      },
    ],
    layout: {
      type: 'vertical',
      children: ['summary', 'done'],
    },
  };

  return {
    templatePath: `@resume/${def.key}`,
    mode: def.mode,
    template,
  };
}

function cloneLoadedStep(step: LoadedStep): LoadedStep {
  return {
    templatePath: step.templatePath,
    mode: step.mode,
    template: JSON.parse(JSON.stringify(step.template)) as Template,
  };
}
