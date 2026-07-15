// Typed loader for the generated asset manifest (data/assets.json, produced by
// scripts/audit-assets.mjs per 60 §4). Headless-zone module: no three.js, pure data access.
import manifestJson from '../../data/assets.json' with { type: 'json' };

// Canonical PieceType lives in track/pieces.ts from M2.1 (30 §4); mirrored here so the manifest
// loader can type its piece keys without a forward dependency. M2.1 imports this union or replaces it.
export type PieceType =
  | 'straight'
  | 'curve-small'
  | 'curve-large'
  | 'ramp'
  | 'hill'
  | 'bump'
  | 'bridge'
  | 'tunnel'
  | 'junction'
  | 'crossing';

export type AssetId = string;
export type AssetKind = 'track' | 'locomotive' | 'carriage' | 'connector';

export interface ModelEntry {
  file: string;
  kind: AssetKind;
  bounds: { min: [number, number, number]; max: [number, number, number] };
  size: { x: number; y: number; z: number };
  triangles: number;
  baseOffsetY: number;
  yawOffset: number;
  length?: number;
}

export interface SwatchEntry {
  uv: [number, number];
  hex: string;
}

export interface PieceAsset {
  model?: AssetId;
  procedural?: string;
  generator?: string;
  footprint: [number, number][];
  tags: string[];
}

export interface AssetManifest {
  cellSize: number;
  kitScaleFactor: number;
  colormap: string;
  swatches: Record<'wood' | 'stone' | 'metal', SwatchEntry>;
  pieces: Record<string, PieceAsset>;
  procedural: Record<string, string>;
  personaIcons: string;
  audit: { modelCount: number; maxTriangles: number; modelsGzBytes: number; referenceModel: string };
  models: Record<AssetId, ModelEntry>;
}

// The JSON carries a `$schema` banner string; strip it from the typed view.
const raw = manifestJson as unknown as AssetManifest & { $schema?: string };

export const manifest: AssetManifest = raw;
export const CELL_SIZE = manifest.cellSize;
export const KIT_SCALE_FACTOR = manifest.kitScaleFactor;

export function getModel(id: AssetId): ModelEntry {
  const m = manifest.models[id];
  if (!m) throw new Error(`asset manifest: unknown model '${id}'`);
  return m;
}

export function getPieceAsset(type: PieceType): PieceAsset {
  const p = manifest.pieces[type];
  if (!p) throw new Error(`asset manifest: no piece asset for '${type}'`);
  return p;
}

/** Resolve a piece to a concrete model id or a procedural generator key (60 §9 completeness). */
export function resolvePiece(type: PieceType): { model: AssetId } | { procedural: string } {
  const p = getPieceAsset(type);
  if (p.model) return { model: p.model };
  if (p.generator) return { procedural: p.generator };
  throw new Error(`asset manifest: piece '${type}' resolves to neither model nor generator`);
}

export function getSwatch(name: 'wood' | 'stone' | 'metal'): SwatchEntry {
  return manifest.swatches[name];
}
