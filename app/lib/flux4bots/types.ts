export type Pointer = string;

export type Binding = { path: Pointer }; // may include ${/pointer} segments

export type TextOptions = { readOnly?: boolean };
export type SelectOptions =
  | { values?: string[] }; // explicit list

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
export type ListWidget = {
  id: string; type: 'list'; label?: string; binding: Binding;
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

// Document store plugs in how to load/save the JSON doc
export interface DocumentStore {
  getDoc(): Promise<any>;
  applyPatch(ops: Operation[]): Promise<any>;
}

// ---- JSON Patch (subset we use) ----
export type Operation =
  | { op: 'add'; path: string; value: any }
  | { op: 'replace'; path: string; value: any }
  | { op: 'remove'; path: string };

// ---- Action handler context & registry ----
export type ActionHandlerContext = {
  doc: any;                        // original doc (before action)
  working: any;                    // current working doc (preview)
  vars: Record<string, any>;       // unbound widget values
  helpers: {
    encode: (s: string) => string; // JSON Pointer segment encoder
    get: (obj: any, ptr: string) => any;
  };
};

export type ActionHandler = (ctx: ActionHandlerContext) => Operation[];
export type ActionRegistry = Record<string, ActionHandler>;

// ---- Flux4Bots props ----
export type Flux4BotsProps = {
  template: Template;
  store: DocumentStore;
  mode?: 'diff' | 'explicit';
  actions?: ActionRegistry;
  ui?: {
    showPatchPreview?: boolean;
    showApplyButton?: boolean;
    showCurrentJson?: boolean;
  };
};
