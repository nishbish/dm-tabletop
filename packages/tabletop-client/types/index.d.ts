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
  /** false: this user may not change the model, so the Edit menu leaves its form out. */
  editable?: boolean;
}

export interface TabletopNotice {
  title: string;
  description: string;
  /** A button that opens the link in a new tab. */
  action?: { label: string; href: string };
}

export interface TabletopOptions {
  /** WebSocket address of tabletop-server. Default: ws(s)://<this host>:3000 */
  serverUrl?: string;
  /**
   * Sent in the join message; the server's authenticate hook decides what it means. Default: random per browser tab.
   * A function is called with `{ roomId }` (the room about to be joined) before every connection attempt, also
   * reconnects and room switches. It may be async, so short-lived tokens are fetched fresh. If it throws or rejects, that attempt failed and the usual backoff applies; an error with
   * `fatal: true` stops retrying instead.
   */
  token?: string | ((join: { roomId: string }) => string | Promise<string>);
  roomId?: string;
  /** Offline demo, no server needed. */
  demo?: boolean;
  /** Prefix for files the viewer loads itself (default image locations, skybox faces). */
  assetBaseUrl?: string;
  imageUrl?: (request: ImageRequest) => string;
  avatarUrl?: (user: { userId: string; name: string }) => string;
  uploadModel?: (formData: FormData) => Promise<unknown>;
  uploadPlane?: (formData: FormData) => Promise<unknown>;
  /** Shown when the upload buttons are pressed and there is no upload hook (keeps them visible). */
  uploadLocked?: TabletopNotice;
  inviteLink?: (code: string) => string;
  trackerUrl?: string;
  /** Draws a tracker into the side drawer the first time it opens; wins over trackerUrl. */
  mountTracker?: (element: HTMLElement) => void;
  /** Extra side buttons (icon: a Material Icons name). */
  buttons?: {
    name: string;
    title: string;
    icon: string;
    help?: string;
    hostOnly?: boolean;
    onClick: () => void;
  }[];
  /** Room messages the host app handles itself: incoming updates with these names go to onAppEvent. */
  appEvents?: string[];
  onAppEvent?: (name: string, args: Record<string, unknown>, from: string | undefined) => void;
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

export interface TabletopView {
  position: [number, number, number];
  quaternion: [number, number, number, number];
  target: [number, number, number];
  fov: number;
  near: number;
  far: number;
  width: number;
  height: number;
  /** Height of the table top (the floor the maps lie on). */
  floorY: number;
}

export interface Tabletop {
  destroy(): void;
  getSceneStats(): SceneStats | null;
  getTokenPosition(tokenId: string): { x: number; y: number; z: number } | null;
  getTokenScreenPosition(tokenId: string): { x: number; y: number } | null;
  /** Sends one of options.appEvents to the room; false when not connected. */
  sendAppEvent(name: string, args: Record<string, unknown>): boolean;
  /** A message that stays until it is closed. */
  showNotice(notice: TabletopNotice): void;
  /**
   * The camera as plain numbers, for drawing a layer over the scene with the same view. In the 2D
   * view it is a camera with perspective straight above the same spot, showing the floor at the
   * same size.
   */
  getView(): TabletopView | null;
  /** Puts an element (a transparent canvas) just above the 3D scene, below the viewer's panels. */
  attachOverlay(element: HTMLElement): () => void;
  debug?: unknown;
}

export function createTabletop(container: HTMLElement, options?: TabletopOptions): Tabletop;
