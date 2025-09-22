import * as YAML from 'js-yaml';
import type { Template } from '../types';

export function loadYamlTemplateFromString(yaml: string): Template {
  return YAML.load(yaml) as Template;
}
