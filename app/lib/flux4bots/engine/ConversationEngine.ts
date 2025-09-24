import { applyPatch } from '../core/patch';
import type { DocumentStore, Operation, LoadedStep, CommittedStep, StepMode, ActionRuntime } from '../types';

export type { LoadedStep, CommittedStep, StepMode } from '../types';

export interface ConversationsAdapter {
  create(title: string, initial: any): Promise<{ id: string; title: string }>;
  list(): Promise<{ id: string; title: string; updated_at: string }[]>;
  load(id: string): Promise<{ id: string; title: string; initial: any; steps: CommittedStep[] }>;
  rename(id: string, title: string): Promise<void>;
  appendStep(id: string, step: Omit<CommittedStep, 'at'>): Promise<void>;
  undo(id: string): Promise<void>;
}

export class ConversationEngine {
  readonly steps: LoadedStep[];
  readonly adapter?: ConversationsAdapter;
  private onCommitted?: (step: CommittedStep, updatedDoc: any) => void;

  private _initialDoc: any;
  private _currentDoc: any;
  private _committed: CommittedStep[] = [];
  private _convId: string | null = null;
  private _pendingSteps: LoadedStep[] = [];
  private _sessionState: Record<string, any> = {};
  private readonly _runtime: ActionRuntime;

  readonly store: DocumentStore;

  constructor(opts: {
    initialDoc: any;
    steps: LoadedStep[];
    adapter?: ConversationsAdapter;
    onCommitted?: (step: CommittedStep, updatedDoc: any) => void;
  }) {
    this._initialDoc = deepClone(opts.initialDoc);
    this._currentDoc = deepClone(opts.initialDoc);
    this.steps = opts.steps;
    this.adapter = opts.adapter;
    this.onCommitted = opts.onCommitted;
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
          templatePath: activeStep?.templatePath ?? '',
          mode: activeStep?.mode ?? 'explicit',
          ops,
          at: new Date().toISOString(),
        };
        this._committed = [...this._committed, committedStep];
        this._currentDoc = applyPatch(this._currentDoc, ops);

        if (this._pendingSteps.length > 0 && activeStep === this._pendingSteps[0]) {
          this._pendingSteps = this._pendingSteps.slice(1);
        }

        // persist if adapter + conv
        if (this.adapter && this._convId) {
          try {
            await this.adapter.appendStep(this._convId, {
              templatePath: committedStep.templatePath,
              mode: committedStep.mode,
              ops: committedStep.ops,
            });
          } catch { /* swallow */ }
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
    this._pendingSteps = [...this._pendingSteps, ...steps.map(cloneLoadedStep)];
  }

  get runtime(): ActionRuntime { return this._runtime; }

  private getSessionState<T>(key: string): T | undefined {
    if (!(key in this._sessionState)) return undefined;
    return deepClone(this._sessionState[key]) as T;
  }

  private setSessionState(key: string, value: any) {
    if (value === undefined) {
      delete this._sessionState[key];
      return;
    }
    this._sessionState[key] = deepClone(value);
  }

  private clearSessionState() {
    this._sessionState = {};
  }

  private completeCurrentStep() {
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
    if (this.adapter && this._convId) {
      this.adapter.appendStep(this._convId, {
        templatePath: committedStep.templatePath,
        mode: committedStep.mode,
        ops: committedStep.ops,
      }).catch(() => {});
    }
    if (this.onCommitted) this.onCommitted(committedStep, deepClone(this._currentDoc));
  }

  resetTo(doc: any) {
    this._initialDoc = deepClone(doc);
    this._currentDoc = deepClone(doc);
    this._committed = [];
    this._pendingSteps = [];
    this.clearSessionState();
  }

  async newConversation(title = cryptoUUID()) {
    this.resetTo(this._initialDoc);
    if (!this.adapter) { this._convId = null; return; }
    try {
      const created = await this.adapter.create(title, this._initialDoc);
      this._convId = created.id;
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

  async loadConversation(id: string) {
    if (!this.adapter) return;
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
    this.clearSessionState();
  } catch { /* swallow */ }
  }

  async renameConversation(newTitle: string) {
    if (this.adapter && this._convId) {
      try { await this.adapter.rename(this._convId, newTitle); } catch {}
    }
  }

  async undoLast() {
    if (this._committed.length === 0) return;
    const next = this._committed.slice(0, -1);
    let doc = deepClone(this._initialDoc);
    for (const st of next) doc = applyPatch(doc, st.ops);
    this._committed = next;
    this._currentDoc = doc;
    this._pendingSteps = [];
  if (this.adapter && this._convId) {
      try { await this.adapter.undo(this._convId); } catch {}
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
