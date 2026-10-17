export interface ImageRequest {
  kind: 'model' | 'plane';
  src: string;
  size: number;
  quality: number;
}

export interface ModelInfo {
  id: string;
  name: string;
  /** Image reference passed to imageUrl(). Empty or missing: a coloured cylinder is drawn. */
  src?: string;
  textureRepeat?: [number, number];
  textureOffset?: [number, number];
  size?: number;
  scale?: number;
  modelOffset?: [number, number];
  viewDistance?: number;
  /** 0xRRGGBB */
  baseColor?: number;
}

export interface TabletopOptions {
  /** WebSocket address of tabletop-server. Default: ws(s)://<this host>:3000 */
  serverUrl?: string;
  /** Sent in the join message; the server's authenticate hook decides what it means. Default: random per browser tab. */
  token?: string;
  roomId?: string;
  /** Offline demo, no server needed. */
  demo?: boolean;
  /** Prefix for files the viewer loads itself (default image locations, skybox faces). */
  assetBaseUrl?: string;
  imageUrl?: (request: ImageRequest) => string;
  avatarUrl?: (user: { userId: string; name: string }) => string;
  uploadModel?: (formData: FormData) => Promise<unknown>;
  uploadPlane?: (formData: FormData) => Promise<unknown>;
  inviteLink?: (code: string) => string;
  trackerUrl?: string;
  resolveModel?: (
    modelId: string,
  ) => ModelInfo | null | undefined | Promise<ModelInfo | null | undefined>;
  skybox?: {
    day?: { path: string; extension?: string };
    night?: { path: string; extension?: string };
  };
  debug?: boolean;
}

export interface SceneStats {
  tokens: number;
  planes: number;
  doors: number;
  wallPoints: number;
  wallGroups: number;
  users: number;
  isHost: boolean;
  userId: string;
  tokenIds: string[];
  status: string;
}

export interface Tabletop {
  destroy(): void;
  getSceneStats(): SceneStats | null;
  getTokenPosition(tokenId: string): { x: number; y: number; z: number } | null;
  debug?: unknown;
}

export function createTabletop(container: HTMLElement, options?: TabletopOptions): Tabletop;
