/** Node-only: read every content/*.json from disk (scripts and tests). */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CONTENT_FILES, CONTENT_KEYS, type RawContent } from './validate';

const contentDir = fileURLToPath(new URL('../../content/', import.meta.url));

/** Returns the raw JSON per bundle key plus problems for files that could not be read. */
export const readContentDir = (dir: string = contentDir): { raw: RawContent; problems: string[] } => {
  const raw: RawContent = {};
  const problems: string[] = [];
  for (const key of CONTENT_KEYS) {
    const file = CONTENT_FILES[key].file;
    try {
      raw[key] = JSON.parse(readFileSync(dir + file, 'utf8'));
    } catch (err) {
      problems.push(`${file}: cannot read or parse JSON (${err instanceof Error ? err.message : String(err)})`);
      raw[key] = [];
    }
  }
  return { raw, problems };
};
