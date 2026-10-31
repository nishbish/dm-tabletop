import { ModelInfo, TabletopOptions } from './config';

// Colours of the built-in tokens (plain cylinders). A self-hosted server with no asset library
// still gives the host these to place.
const PALETTE: [string, number][] = [
  ['Red', 0xc0392b],
  ['Blue', 0x2e6fd0],
  ['Green', 0x2f9e5a],
  ['Yellow', 0xd6b02a],
  ['Purple', 0x8e44ad],
  ['Orange', 0xe67e22],
  ['White', 0xe8e8e8],
  ['Black', 0x2b2b2b],
];

export const DEFAULT_MODEL_PREFIX = 'default-';

// The base under a 3D character: plain, so the character is what you look at.
const CHARACTER_BASE_COLOR = 0x3a3a3a;

export function builtInModels(): ModelInfo[] {
  return PALETTE.map(([name, colour]) =>
    makeModel(DEFAULT_MODEL_PREFIX + name.toLowerCase(), name, colour),
  );
}

function makeModel(id: string, name: string, baseColor: number): ModelInfo {
  return {
    id,
    name,
    src: '',
    textureRepeat: [1, 1],
    textureOffset: [0, 0],
    size: 1,
    scale: 1,
    modelOffset: [0, 0],
    viewDistance: 60,
    baseColor,
  };
}

// Model for an id nobody can describe: a cylinder whose colour comes from the id, so the same
// id looks the same for everyone.
export function fallbackModel(modelId: string): ModelInfo {
  const builtIn = builtInModels().find((m) => m.id === modelId);
  if (builtIn) return builtIn;
  let hash = 0;
  for (let i = 0; i < modelId.length; i++) hash = (hash * 31 + modelId.charCodeAt(i)) | 0;
  const colour = PALETTE[Math.abs(hash) % PALETTE.length][1];
  return makeModel(modelId, 'Token ' + modelId.slice(0, 24), colour);
}

// Fills in missing fields so a host app can return only what it knows.
function normalise(modelId: string, raw: Partial<ModelInfo>): ModelInfo {
  const base = fallbackModel(modelId);
  return {
    ...base,
    ...raw,
    id: modelId,
    baseColor: typeof raw.baseColor === 'number' ? raw.baseColor : base.baseColor,
  };
}

// Resolves model ids with caching; never throws and never returns null.
export class ModelResolver {
  private cache = new Map<string, ModelInfo>();
  constructor(private options: Pick<TabletopOptions, 'resolveModel' | 'modelLibrary'>) {}

  has(modelId: string): boolean {
    return this.cache.has(modelId);
  }

  put(model: ModelInfo): void {
    this.cache.set(model.id, model);
  }

  async resolve(modelId: string): Promise<ModelInfo> {
    const cached = this.cache.get(modelId);
    if (cached) return cached;
    let model: ModelInfo | undefined;
    const character = this.options.modelLibrary?.characters?.find((c) => c.id === modelId);
    if (character) {
      model = normalise(modelId, { name: character.name, baseColor: CHARACTER_BASE_COLOR });
    } else if (this.options.resolveModel) {
      try {
        const found = await this.options.resolveModel(modelId);
        if (found) model = normalise(modelId, found);
      } catch {
        // fall through to the default token
      }
    }
    if (!model) model = fallbackModel(modelId);
    this.cache.set(modelId, model);
    return model;
  }
}

// Model -> the flat argument shape the viewer's defineModel / getModel handlers take.
export function modelToArgs(m: ModelInfo): Record<string, unknown> {
  return {
    modelId: m.id,
    name: m.name,
    src: m.src || '',
    textureRepeatX: m.textureRepeat[0],
    textureRepeatY: m.textureRepeat[1],
    textureOffsetX: m.textureOffset[0],
    textureOffsetY: m.textureOffset[1],
    size: m.size,
    scale: m.scale,
    modelOffsetX: m.modelOffset[0],
    modelOffsetY: m.modelOffset[1],
    viewDistance: m.viewDistance,
    baseColor: m.baseColor,
  };
}

// Small round colour image used as a thumbnail for tokens that have no picture.
export function swatchUrl(colour: number): string {
  const hex = ('000000' + (colour >>> 0).toString(16)).slice(-6);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="26" fill="#${hex}" stroke="#fff" stroke-width="3"/></svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}
