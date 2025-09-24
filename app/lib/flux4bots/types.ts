export type Pointer = string;

export type Binding = { path: Pointer }; // may include ${/pointer} segments

export type TextOptions = { readOnly?: boolean };

// Values for selects can be simple strings or labeled objects
export type SelectValue = string | { value: string; label?: string };
export type SelectOptions = {
  values?: SelectValue[];                 // explicit list
  variant?: 'chips' | 'dropdown';         // UI variant used by Flux4Bots
  multiple?: boolean;                     // allow multi-select (esp. for chips)
};

// NEW: list items sourced from object keys
export type KeysSource = {
  type: 'keys';
  basePath: Pointer;      // e.g. "/contact"
  exclude?: string[];     // e.g. ["name"]
};

export type FieldPickerOptions = { basePath: Pointer; selection: 'single' | 'multiple' };

export type TextWidget = {
  id: string; type: 'text'; label?: string;
  binding?: Binding; // optional: if omitted, value is captured in vars[id]
  options?: TextOptions;
};
export type SelectWidget = {
  id: string; type: 'select'; label?: string;
  binding?: Binding; // optional: if omitted, selection captured in vars[id]
  options?: SelectOptions;
};
export type ListItemSpec = {
  expandable?: boolean;
  fields: (TextWidget | SelectWidget)[];
};
export type ListWidget =
  | {
      id: string; type: 'list'; label?: string;
      binding: Binding;            // existing array-driven list
      item: ListItemSpec;
    }
  | {
      id: string; type: 'list'; label?: string;
      source: KeysSource;          // NEW: keys-driven list
      item: ListItemSpec;
    };
export type FieldPickerWidget = {
  id: string; type: 'field-picker'; label?: string;
  binding?: Binding; // optional: write result to a binding (string or array)
  options: FieldPickerOptions;
};
export type ActionWidget = {
  id: string; type: 'action'; label: string;
  options?: { action?: string };
};

export type Widget = TextWidget | SelectWidget | ListWidget | FieldPickerWidget | ActionWidget;

export type Template = {
  version: 1;
  name: string;
  widgets: Widget[];
  layout: { type: 'vertical'; children: string[] };
};

// ---- Steps, templates & modes ----
export type StepMode = 'diff' | 'explicit';

export type TemplateRef = {
  templatePath: string;
  mode: StepMode;
};

// Instance that carries the actual parsed Template
export type TemplateInstance = TemplateRef & { template: Template };

// Engine-consumed step
export type LoadedStep = TemplateInstance;

// ---- JSON Patch (subset we use) ----
export type Operation =
  | { op: 'add'; path: string; value: any }
  | { op: 'replace'; path: string; value: any }
  | { op: 'remove'; path: string };

// Committed (persisted) step
export type CommittedStep = TemplateRef & {
  ops: Operation[];
  at: string; // ISO timestamp
};

// Document store plugs in how to load/save the JSON doc
export interface DocumentStore {
  getDoc(): Promise<any>;
  applyPatch(ops: Operation[]): Promise<any>;
}

// ---- Action runtime (injected by engine / UI) ----
export type ActionRuntime = {
  enqueueSteps: (steps: LoadedStep[]) => void;
  getState?: <T = any>(key: string) => T | undefined;
  setState?: <T = any>(key: string, value: T) => void;
  completeStep?: () => void;
};

// ---- Action handler context & registry ----
export type ActionHandlerContext = {
  doc: any;                        // original doc (before action)
  working: any;                    // current working doc (preview)
  vars: Record<string, any>;       // unbound widget values
  helpers: {
    encode: (s: string) => string; // JSON Pointer segment encoder
    get: (obj: any, ptr: string) => any;
  };
  runtime: ActionRuntime;          // runtime hooks (enqueue steps, session state, etc.)
};

export type ActionHandler = (ctx: ActionHandlerContext) => Operation[];
export type ActionRegistry = Record<string, ActionHandler>;

// ---- Flux4Bots props ----
export type Flux4BotsProps = {
  template: Template;
  store: DocumentStore;
  mode?: 'diff' | 'explicit';
  actions?: ActionRegistry;
  runtime?: ActionRuntime;
  ui?: {
    showPatchPreview?: boolean;
    showApplyButton?: boolean;
    showCurrentJson?: boolean;
  };
};
