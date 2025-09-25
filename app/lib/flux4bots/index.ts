export type {
  Pointer,
  Binding,
  StepMode,
  TemplateRef,
  TemplateInstance,
  LoadedStep,
  CommittedStep,
  Operation,
  DocumentStore,
  ActionRuntime,
  ActionHandlerContext,
  ActionHandler,
  ActionRegistry,
  Template,
  Widget,
  TextWidget,
  SelectWidget,
  ActionWidget,
  FieldPickerWidget,
  ListWidget,
  TextOptions,
  SelectValue,
  SelectOptions,
  KeysSource,
  ListItemSpec,
  SkillPillOptions,
  FieldPickerOptions,
  Flux4BotsProps,
} from './types';

export { Flux4Bots } from './components/Flux4Bots';
export { ChipSelect } from './components/ChipSelect';
export { ConversationEngine, type ConversationsAdapter } from './engine/ConversationEngine';
export { getAtPointer, setAtPointer, encodePointerSegment, joinPointer, decodePointerSegment } from './core/pointer';
export { resolveBindingPath } from './core/binding';
export { compareDocsToPatch, applyPatch } from './core/patch';
export { MemoryDocumentStore } from './stores/memory';
export { FastApiDocumentStore } from './stores/fastapi';
export { FastApiAdapter } from './persistence/FastApiAdapter';
export { builtins } from './actions/builtins';

// YAML helpers
export { useYamlTemplate } from './yaml/loader';          // client-only
export { loadYamlTemplateFromString } from './yaml/parse'; // server-safe

// Workflows
export {
  createResumeActions,
  getResumeSectionSteps,
  RESUME_SECTION_CONFIG,
  type ResumeSectionKey,
} from './workflows/resume';
