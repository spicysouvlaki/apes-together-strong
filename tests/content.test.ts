import { describe, expect, it } from 'vitest';
import { readContentDir } from '../scripts/lib/read-content';
import { validateContent, type RawContent } from '../scripts/lib/validate';

const live = readContentDir();
const clone = (): Record<string, Record<string, unknown>[]> => structuredClone(live.raw) as Record<string, Record<string, unknown>[]>;
const first = <T>(list: T[] | undefined): T => {
  const v = list?.[0];
  if (v === undefined) throw new Error('fixture needs at least one entry');
  return v;
};
const problemsOf = (raw: Record<string, unknown>): string[] => validateContent(raw as RawContent);

describe('content validation', () => {
  it('live content has no problems', () => {
    expect([...live.problems, ...validateContent(live.raw)]).toEqual([]);
  });

  it('reports schema errors with file, id and path', () => {
    const raw = clone();
    first(raw.figures).kind = 'wizard';
    const id = String(first(raw.figures).id);
    expect(problemsOf(raw)).toContainEqual(expect.stringMatching(new RegExp(`^figures\\.json \\[${id}\\] kind:`)));
  });

  it('reports duplicate ids and the shared production namespace', () => {
    const raw = clone();
    raw.cultures?.push({ ...first(raw.cultures) });
    raw.buildings?.push({ ...first(raw.buildings), id: String(first(raw.units).id) });
    const problems = problemsOf(raw);
    expect(problems).toContainEqual(expect.stringMatching(/^cultures\.json \[.+\] id: duplicate id/));
    expect(problems).toContainEqual(expect.stringMatching(/share one id namespace/));
  });

  it('reports unknown cultures, slots, activate effects and archetype naming', () => {
    const raw = clone();
    const f = first(raw.figures);
    f.culture = 'atlantean';
    f.cabinetSlots = ['no_such_slot'];
    f.activate = { effect: 'summon_dragon' };
    f.archetype = true; // name does not start with "A "/"An " and bio not "Archetype."
    const problems = problemsOf(raw);
    expect(problems).toContainEqual(expect.stringMatching(/unknown culture "atlantean"/));
    expect(problems).toContainEqual(expect.stringMatching(/unknown cabinet slot "no_such_slot"/));
    expect(problems).toContainEqual(expect.stringMatching(/unknown activate effect "summon_dragon"/));
    expect(problems).toContainEqual(expect.stringMatching(/archetype names must start/));
    expect(problems).toContainEqual(expect.stringMatching(/archetype bios must start with "Archetype\."/));
  });

  it('reports legend bios and deed links', () => {
    const raw = clone();
    const f = first(raw.figures);
    f.kind = 'legend';
    f.deed = 'missing_deed';
    raw.deeds = [{ id: 'orphan_deed', name: 'Orphan', description: 'x', trigger: { measure: 'battlesWon', count: 3 } }];
    const problems = problemsOf(raw);
    expect(problems).toContainEqual(expect.stringMatching(/legend bios must start with "Legend\."/));
    expect(problems).toContainEqual(expect.stringMatching(/unknown deed "missing_deed"/));
    expect(problems).toContainEqual(expect.stringMatching(/deeds\.json \[orphan_deed\].*exactly one figure/));
  });

  it('reports tradition requirement and tech tree problems', () => {
    const raw = clone();
    const t = first(raw.traditions);
    t.requires = [String(t.id)]; // same tier as itself
    const techs = raw.techs ?? [];
    const a = first(techs);
    const b = techs[1];
    if (!b) throw new Error('need two techs');
    a.requires = [String(b.id)];
    b.requires = [String(a.id)];
    b.col = a.col;
    b.row = a.row;
    b.tree = a.tree;
    b.age = a.age;
    const problems = problemsOf(raw);
    expect(problems).toContainEqual(expect.stringMatching(/must be a lower tier/));
    expect(problems).toContainEqual(expect.stringMatching(/dependency cycle/));
    expect(problems).toContainEqual(expect.stringMatching(/same tree cell/));
  });

  it('reports unknown ids inside modifier conditions and unlocks', () => {
    const raw = clone();
    const t = first(raw.traditions);
    t.modifiers = [
      { scope: 'tile', when: { terrain: ['lava'], feature: ['volcano'], resource: ['unobtainium'] }, effect: { kind: 'yield', yield: 'food', add: 1 } },
      { scope: 'empire', effect: { kind: 'unlock', what: 'unit', id: 'mech' } },
    ];
    const problems = problemsOf(raw);
    expect(problems).toContainEqual(expect.stringMatching(/unknown terrain "lava"/));
    expect(problems).toContainEqual(expect.stringMatching(/unknown feature "volcano"/));
    expect(problems).toContainEqual(expect.stringMatching(/unknown resource "unobtainium"/));
    expect(problems).toContainEqual(expect.stringMatching(/unlock of unknown unit "mech"/));
  });

  it('requires a founder unit and figure stand-in units', () => {
    const raw = clone();
    raw.units = (raw.units ?? []).map((u) => ({ ...u, canFound: false, figureKind: undefined }));
    const problems = problemsOf(raw);
    expect(problems).toContainEqual(expect.stringMatching(/able to found settlements/));
    expect(problems).toContainEqual(expect.stringMatching(/no unit def for figure kind "general"/));
    expect(problems).toContainEqual(expect.stringMatching(/no unit def for figure kind "explorer"/));
  });

  it('reports a missing file', () => {
    const raw = clone();
    delete raw.hybrids;
    expect(problemsOf(raw)).toContain('hybrids.json: file missing');
  });
});
