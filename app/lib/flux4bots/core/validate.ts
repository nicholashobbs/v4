import type { Template } from '../types';

/**
 * Very light template hygiene checks.
 * Returns human-readable warnings; it never throws.
 */
export function validateTemplate(tpl: Template): string[] {
  const msgs: string[] = [];

  // --- shape checks ---
  if (tpl.version !== 1) msgs.push(`Template "${tpl.name}": version should be 1.`);
  if (!tpl.layout || tpl.layout.type !== 'vertical') {
    msgs.push(`Template "${tpl.name}": only layout.type="vertical" is supported.`);
  }

  // widgets map
  const widgetIds = new Set<string>();
  for (const w of tpl.widgets) {
    if (!w.id) {
      msgs.push(`Template "${tpl.name}": a widget is missing an id.`);
    } else if (widgetIds.has(w.id)) {
      msgs.push(`Template "${tpl.name}": duplicate widget id "${w.id}".`);
    } else {
      widgetIds.add(w.id);
    }
  }

  // layout children exist
  if (tpl.layout?.type === 'vertical') {
    for (const cid of tpl.layout.children ?? []) {
      if (!widgetIds.has(cid)) msgs.push(`Template "${tpl.name}": layout child "${cid}" not found in widgets.`);
    }
  }

  // --- per widget checks ---
  for (const w of tpl.widgets) {
    switch (w.type) {
      case 'text': {
        const path = (w as any).binding?.path;
        if (path != null && typeof path !== 'string') {
          msgs.push(`text "${w.id}": binding.path must be a string if provided.`);
        }
        break;
      }

      case 'select': {
        const path = (w as any).binding?.path;
        if (path != null && typeof path !== 'string') {
          msgs.push(`select "${w.id}": binding.path must be a string if provided.`);
        }
        const values = (w as any).options?.values;
        if (values != null && !Array.isArray(values)) {
          msgs.push(`select "${w.id}": options.values must be an array of strings if provided.`);
        }
        break;
      }

      case 'list': {
        // list can be array-driven (binding) OR keys-driven (source)
        const anyW = w as any;
        const wid = anyW?.id ?? '?';

        const hasBinding = 'binding' in anyW;
        const hasSource  = 'source'  in anyW;

        if (!hasBinding && !hasSource) {
            msgs.push(`list "${wid}": must provide either "binding" (array) or "source" (keys).`);
            break;
        }

        if (hasBinding) {
            const path = anyW.binding?.path;
            if (typeof path !== 'string' || !path.startsWith('/')) {
            msgs.push(`list "${wid}": binding.path must be a JSON Pointer (start with "/").`);
            }
        }

        if (hasSource) {
            const src = anyW.source;
            if (!src || src.type !== 'keys') {
            msgs.push(`list "${wid}": source.type must be "keys" when using keys-driven lists.`);
            } else {
            if (typeof src.basePath !== 'string' || !src.basePath.startsWith('/')) {
                msgs.push(`list "${wid}": source.basePath must be a JSON Pointer (start with "/").`);
            }
            if (src.exclude != null && !Array.isArray(src.exclude)) {
                msgs.push(`list "${wid}": source.exclude must be an array of strings if provided.`);
            }
            }
        }

        // Validate item.fields (each field is text/select; binding.path may be "" in keys-mode)
        const item = anyW.item;
        if (!item || !Array.isArray(item.fields)) {
            msgs.push(`list "${wid}": item.fields must be an array.`);
        } else {
            for (const f of item.fields) {
            const anyF = f as any;
            if (anyF.type !== 'text' && anyF.type !== 'select') {
                msgs.push(`list "${wid}": unsupported item field type "${anyF.type}".`);
                continue;
            }
            const fPath = anyF.binding?.path;
            if (fPath != null && typeof fPath !== 'string') {
                msgs.push(`list "${wid}": item field "${anyF.id ?? '(unnamed)'}" binding.path must be a string if provided.`);
            }
            if (anyF.type === 'select') {
                const vals = anyF.options?.values;
                if (vals != null && !Array.isArray(vals)) {
                msgs.push(`list "${wid}": item select "${anyF.id ?? '(unnamed)'}" options.values must be an array of strings if provided.`);
                }
            }
            }
        }
        break;
        }


      case 'field-picker': {
        const base = (w as any).options?.basePath;
        if (typeof base !== 'string' || !base.startsWith('/')) {
          msgs.push(`field-picker "${w.id}": options.basePath must be a JSON Pointer (start with "/").`);
        }
        const sel = (w as any).options?.selection;
        if (sel !== 'single' && sel !== 'multiple') {
          msgs.push(`field-picker "${w.id}": options.selection must be "single" or "multiple".`);
        }
        const path = (w as any).binding?.path;
        if (path != null && typeof path !== 'string') {
          msgs.push(`field-picker "${w.id}": binding.path must be a string if provided.`);
        }
        break;
      }

      case 'action': {
        const act = (w as any).options?.action;
        if (act != null && typeof act !== 'string') {
          msgs.push(`action "${w.id}": options.action must be a string if provided.`);
        }
        break;
      }

      default: {
        // No exhaustiveness assertion here; just report unknown widget safely.
        const anyW = w as any;
        msgs.push(`widget "${anyW?.id ?? '?'}": unsupported type "${anyW?.type ?? '?'}".`);
      }
    }
  }

  return msgs;
}
