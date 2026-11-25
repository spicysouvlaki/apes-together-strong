/**
 * npm run validate:content — schema + cross-reference checks for every content/*.json.
 * Prints a summary table, then every problem found; exits 1 if there are any.
 * The checks themselves live in scripts/lib/validate.ts (also used by tests/content.test.ts).
 */
import { AGES } from '../src/contracts/content-schemas';
import { readContentDir } from './lib/read-content';
import { contentSummary, validateContent } from './lib/validate';

const { raw, problems: readProblems } = readContentDir();

const { counts, figures } = contentSummary(raw);
console.log('Content files');
for (const [file, n] of Object.entries(counts)) console.log(`  ${file.padEnd(20)} ${String(n).padStart(4)}`);

console.log('\nFigures per culture x age');
console.log(`  ${'culture'.padEnd(16)}${AGES.map((a) => a.slice(0, 5).padStart(6)).join('')} total`);
for (const culture of Object.keys(figures).sort()) {
  const row = figures[culture];
  if (!row) continue;
  const total = AGES.reduce((s, a) => s + row[a], 0);
  console.log(`  ${culture.padEnd(16)}${AGES.map((a) => String(row[a]).padStart(6)).join('')} ${String(total).padStart(5)}`);
}

const problems = [...readProblems, ...validateContent(raw)];
if (problems.length === 0) {
  console.log('\nContent OK.');
} else {
  console.error(`\n${problems.length} content problem(s):`);
  for (const pr of problems) console.error(`  - ${pr}`);
  process.exit(1);
}
