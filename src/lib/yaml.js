import YAML from 'yaml';
import { readText, writeText } from './fs.js';

export function parseYaml(text) {
  return YAML.parse(text);
}

export function stringifyYaml(value) {
  return YAML.stringify(value, { lineWidth: 0 });
}

export function readYaml(p) {
  return parseYaml(readText(p));
}

export function writeYaml(p, value) {
  return writeText(p, stringifyYaml(value));
}
