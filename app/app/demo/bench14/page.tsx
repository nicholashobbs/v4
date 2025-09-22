import fs from 'node:fs/promises';
import path from 'node:path';
import { loadYamlTemplateFromString, type Template } from '../../../lib/flux4bots';
import ClientBench14 from './ClientBench14';

async function readFirst(paths: string[]): Promise<string> {
  for (const p of paths) {
    try { return await fs.readFile(p, 'utf-8'); } catch {}
  }
  throw new Error(`template.yaml not found. Looked in:\n${paths.join('\n')}`);
}

export default async function Page() {
  const candidates = [
    path.join(process.cwd(), 'app', 'app', 'demo', 'bench14', 'template.yaml'),
    path.join(process.cwd(), 'demo', 'bench14', 'template.yaml'),
    path.join(process.cwd(), 'app', 'demo', 'bench14', 'template.yaml'),
  ];
  const yamlText = await readFirst(candidates);
  const template: Template = loadYamlTemplateFromString(yamlText);
  return <ClientBench14 template={template} />;
}
