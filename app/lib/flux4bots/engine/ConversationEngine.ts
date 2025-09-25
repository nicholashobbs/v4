import { applyPatch } from '../core/patch';
import type { DocumentStore, Operation, LoadedStep, CommittedStep, ActionRuntime, TemplateRef } from '../types';

export interface ConversationsAdapter {
  create(title: string, initial: any): Promise<{ id: string; title: string }>;
  list(): Promise<{ id: string; title: string; updated_at: string }[]>;
  load(id: string): Promise<{ id: string; title: string; initial: any; steps: CommittedStep[]; pendingSteps: TemplateRef[]; sessionState: Record<string, any> }>;
  rename(id: string, title: string): Promise<void>;
  appendStep(id: string, step: Omit<CommittedStep, 'at'>): Promise<void>;
  undo(id: string): Promise<void>;
  saveState(id: string, state: { pendingSteps: TemplateRef[]; sessionState: Record<string, any> }): Promise<void>;
}

export class ConversationEngine {
  readonly steps: LoadedStep[];
  readonly adapter?: ConversationsAdapter;
  private onCommitted?: (step: CommittedStep, updatedDoc: any) => void;

  private readonly _seedInitialDoc: any;
  private readonly _stepCatalog: Map<string, LoadedStep>;
  private _initialDoc: any;
  private _currentDoc: any;
  private _committed: CommittedStep[] = [];
  private _pendingSteps: LoadedStep[] = [];
  private _convId: string | null = null;

  private _sessionState: Record<string, any> = {};
  private readonly _runtime: ActionRuntime;
  private _statePersistScheduled = false;

  readonly store: DocumentStore;

  constructor(opts: {
    initialDoc: any;
    steps: LoadedStep[];
    adapter?: ConversationsAdapter;
    onCommitted?: (step: CommittedStep, updatedDoc: any) => void;
    catalog?: Record<string, LoadedStep>;
  }) {
    this._seedInitialDoc = deepClone(opts.initialDoc);
    this._initialDoc = deepClone(opts.initialDoc);
    this._currentDoc = deepClone(opts.initialDoc);
    this.steps = opts.steps;
    this.adapter = opts.adapter;
    this.onCommitted = opts.onCommitted;
    this._stepCatalog = new Map();
    this.registerCatalogSteps(opts.steps);
    if (opts.catalog) {
      this.registerCatalogSteps(Object.values(opts.catalog));
    }
    this._runtime = {
      enqueueSteps: (steps) => this.enqueueSteps(steps),
      getState: (key) => this.getSessionState(key),
      setState: (key, value) => this.setSessionState(key, value),
      completeStep: () => this.completeCurrentStep(),
    };

    // DocumentStore facade used by <Flux4Bots>
    this.store = {
      getDoc: async () => deepClone(this._currentDoc),
      applyPatch: async (ops: Operation[]) => {
        if (!ops || ops.length === 0) return deepClone(this._currentDoc);
        const activeStep = this.currentStep;
        const committedStep: CommittedStep = {
          templatePath: activeStep?.templatePath ?? 'ad-hoc',
          mode: activeStep?.mode ?? 'diff',
          ops: JSON.parse(JSON.stringify(ops)),
          at: new Date().toISOString(),
        };
        // apply locally
        const next = applyPatch(deepClone(this._currentDoc), committedStep.ops);
        this._currentDoc = next;
        this._committed = [...this._committed, committedStep];

        // Advance queue head if we just committed the current step
        if (this._pendingSteps.length > 0 && activeStep && this._pendingSteps[0] === activeStep) {
          this._pendingSteps = this._pendingSteps.slice(1);
        }

        this.schedulePersistState();

        // Persist (auto-create conversation on first save if needed)
        if (this.adapter) {
          try {
            await this.ensureConversation();
            if (this._convId) {
              this.adapter.appendStep(this._convId, {
                templatePath: committedStep.templatePath,
                mode: committedStep.mode,
                ops: committedStep.ops,
              }).catch(() => { /* swallow */ });
            }
          } catch {
            // swallow
          }
        }

        if (this.onCommitted) this.onCommitted(committedStep, deepClone(this._currentDoc));
        return deepClone(this._currentDoc);
      },
    };
  }

  get currentDoc() { return deepClone(this._currentDoc); }
  get committed(): CommittedStep[] { return this._committed.slice(); }
  get currentStepIndex(): number { return this._committed.length; }
  get currentStep(): LoadedStep | null {
    if (this._pendingSteps.length > 0) return this._pendingSteps[0];
    return this.steps[this.currentStepIndex] ?? null;
  }
  get conversationId(): string | null { return this._convId; }

  enqueueSteps(steps: LoadedStep[]) {
    if (!Array.isArray(steps) || steps.length === 0) return;
    this.registerCatalogSteps(steps);
    this._pendingSteps = [...this._pendingSteps, ...steps.map(cloneLoadedStep)];
    this.schedulePersistState();
  }

  get runtime(): ActionRuntime { return this._runtime; }

  private registerCatalogSteps(steps: LoadedStep[]) {
    for (const step of steps) this.registerCatalogStep(step);
  }

  private registerCatalogStep(step: LoadedStep) {
    if (!step || typeof step.templatePath !== 'string') return;
    this._stepCatalog.set(step.templatePath, cloneLoadedStep(step));
  }

  private resolveStep(templatePath: string): LoadedStep | null {
    if (!templatePath) return null;
    const found = this._stepCatalog.get(templatePath);
    if (!found) return null;
    return cloneLoadedStep(found);
  }

  private takeStateSnapshot(): { pendingSteps: TemplateRef[]; sessionState: Record<string, any> } {
    const pendingSteps = this._pendingSteps.map((step) => ({ templatePath: step.templatePath, mode: step.mode }));
    return {
      pendingSteps,
      sessionState: deepClone(this._sessionState),
    };
  }

  private schedulePersistState() {
    if (!this.adapter || !this._convId) return;
    if (this._statePersistScheduled) return;
    this._statePersistScheduled = true;
    Promise.resolve().then(() => {
      this._statePersistScheduled = false;
      if (!this.adapter || !this._convId) return;
      const snapshot = this.takeStateSnapshot();
      this.adapter.saveState(this._convId, snapshot).catch(() => {});
    });
  }

  private getSessionState<T>(key: string): T | undefined {
    if (!(key in this._sessionState)) return undefined;
    return deepClone(this._sessionState[key]) as T;
  }

  private setSessionState(key: string, value: any) {
    if (value === undefined) {
      delete this._sessionState[key];
    } else {
      this._sessionState[key] = deepClone(value);
    }
    this.schedulePersistState();
  }

  clearSessionState() {
    this._sessionState = {};
  }

  resetTo(doc: any) {
    this._initialDoc = deepClone(doc);
    this._currentDoc = deepClone(doc);
    this._committed = [];
    this._pendingSteps = [];
    this.clearSessionState();
  }

  async newConversation(title = cryptoUUID()) {
    this.resetTo(this._seedInitialDoc);
    this._convId = null;
    if (!this.adapter) { return; }
    try {
      const created = await this.adapter.create(title, this._initialDoc);
      this._convId = created.id;
      this.schedulePersistState();
    } catch {
      this._convId = null;
    }
  }

  async listConversations(): Promise<{ id: string; title: string }[]> {
    if (!this.adapter) return [];
    try {
      const items = await this.adapter.list();
      return items.map(i => ({ id: i.id, title: i.title }));
    } catch {
      return [];
    }
  }

  async loadConversation(id: string): Promise<{ id: string; title: string } | null> {
    if (!this.adapter) return null;
    try {
      const c = await this.adapter.load(id);
      this._convId = c.id;
      this._initialDoc = deepClone(c.initial);
      this._currentDoc = deepClone(c.initial);
      for (const st of c.steps) {
        this._currentDoc = applyPatch(this._currentDoc, st.ops);
      }
      this._committed = c.steps.slice();
      this._pendingSteps = [];
      if (Array.isArray(c.pendingSteps) && c.pendingSteps.length > 0) {
        const hydrated: LoadedStep[] = [];
        for (const ref of c.pendingSteps) {
          const step = this.resolveStep(ref.templatePath);
          if (step) {
            hydrated.push({ ...step, mode: ref.mode });
          }
        }
        this._pendingSteps = hydrated;
      }
      this._sessionState = deepClone(c.sessionState ?? {});
      return { id: c.id, title: c.title };
    } catch {
      return null;
    }
  }

  async renameConversation(newTitle: string) {
    if (!this.adapter) return;
    if (!this._convId) {
      await this.ensureConversation(newTitle);
    }
    if (this._convId) {
      try { await this.adapter.rename(this._convId, newTitle); } catch {}
    }
  }

  completeCurrentStep() {
    const activeStep = this.currentStep;
    if (!activeStep) return;
    const committedStep: CommittedStep = {
      templatePath: activeStep.templatePath,
      mode: activeStep.mode,
      ops: [],
      at: new Date().toISOString(),
    };
    this._committed = [...this._committed, committedStep];
    if (this._pendingSteps.length > 0 && activeStep === this._pendingSteps[0]) {
      this._pendingSteps = this._pendingSteps.slice(1);
    }
    this.schedulePersistState();
    if (this.adapter) {
      this.ensureConversation().then(() => {
        if (this._convId) {
          this.adapter!.appendStep(this._convId, {
            templatePath: committedStep.templatePath,
            mode: committedStep.mode,
            ops: committedStep.ops,
          }).catch(() => {});
        }
      }).catch(() => {});
    }
    if (this.onCommitted) this.onCommitted(committedStep, deepClone(this._currentDoc));
  }

  async undoLast() {
    if (this._committed.length === 0) return;
    const next = this._committed.slice(0, -1);
    let doc = deepClone(this._initialDoc);
    for (const st of next) doc = applyPatch(doc, st.ops);
    this._committed = next;
    this._currentDoc = doc;
    this._pendingSteps = [];
    this.schedulePersistState();
    if (this.adapter && this._convId) {
      try { await this.adapter.undo(this._convId); } catch {}
    } else if (this.adapter) {
      // Create a conversation so future undo/redo can persist (no-op if created later on commit)
      try { await this.ensureConversation(); } catch {}
    }
  }

  // Lazy-create a conversation so autosave always works
  private async ensureConversation(defaultTitle?: string) {
    if (!this.adapter) return;
    if (this._convId) return;
    try {
      const created = await this.adapter.create(defaultTitle || cryptoUUID(), this._initialDoc);
      this._convId = created.id;
      this.schedulePersistState();
    } catch {
      // swallow
    }
  }
}

/* ------------ small helpers ------------ */
function deepClone<T>(v: T): T { return JSON.parse(JSON.stringify(v)); }
function cloneLoadedStep(step: LoadedStep): LoadedStep {
  return {
    templatePath: step.templatePath,
    mode: step.mode,
    template: JSON.parse(JSON.stringify(step.template)),
  };
}
function cryptoUUID(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  // fallback
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}
