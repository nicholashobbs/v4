import fs from 'node:fs/promises';
import path from 'node:path';
import { loadYamlTemplateFromString, type Template } from '../../../lib/flux4bots';
import ClientBench11 from './ClientBench11';

export default async function Page() {
  const yamlPath = path.join(process.cwd(), 'app', 'demo', 'bench11', 'template.yaml');
  const yamlText = await fs.readFile(yamlPath, 'utf-8');
  const template: Template = loadYamlTemplateFromString(yamlText);
  return <ClientBench11 template={template} />;
}
