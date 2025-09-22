import type { Template, Widget } from '../types';

export function validateTemplate(tpl: Template): string[] {
  const warnings: string[] = [];

  if (tpl.version !== 1) {
    warnings.push(`Unsupported template version: ${tpl.version}. Expected 1.`);
  }
  if (!tpl.layout || tpl.layout.type !== 'vertical') {
    warnings.push(`Unsupported or missing layout. Only { type: "vertical" } is supported.`);
  }

  const widgetIds = new Set((tpl.widgets ?? []).map(w => w.id));
  // Ensure every child in layout exists
  for (const cid of tpl.layout?.children ?? []) {
    if (!widgetIds.has(cid)) warnings.push(`Layout references missing widget id: "${cid}".`);
  }

  // Light per-widget checks (only structural—not data)
  for (const w of tpl.widgets ?? []) {
    switch (w.type) {
      case 'list':
        if (!w.binding?.path) warnings.push(`List widget "${w.id}" requires a binding.path.`);
        if (!w.item?.fields?.length) warnings.push(`List widget "${w.id}" has no item.fields configured.`);
        break;
      case 'field-picker':
        if (!w.options?.basePath) warnings.push(`Field-picker "${w.id}" requires options.basePath.`);
        break;
      case 'action':
        // Action name is optional in YAML, but warn if missing to avoid confusion
        if (!w.options?.action) warnings.push(`Action widget "${w.id}" has no options.action name.`);
        break;
      case 'text':
      case 'select':
        // Binding is optional (unbound fields go to vars), so no warning here.
        break;
      default:
        warnings.push(`Unsupported widget type on id "${(w as Widget).id}".`);
    }
  }

  return warnings;
}
