/**
 * Shared colorblind-pattern switch (GDD §11 accessibility). One `uPatterns` uniform turns the
 * owner patterns on/off at runtime without recompiling every material that cuts them: the
 * territory band (border-mesh.ts) and the banner flags (materials.ts propMaterial FLAG).
 */
import type { IUniform } from 'three';

export interface PatternUniforms {
  uPatterns: IUniform<number>;
}

export const createPatternUniforms = (on: boolean): PatternUniforms => ({ uPatterns: { value: on ? 1 : 0 } });
