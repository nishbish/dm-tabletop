// Options accepted by createTabletop() and their defaults. Everything the viewer needs to know
// about its environment comes from here; nothing is hard-coded elsewhere.

export interface ImageRequest {
  kind: 'model' | 'plane';
  src: string;
  size: number;
  quality: number;
}

export interface UserInfo {
  userId: string;
  name: string;
}

// Token appearance, in the shape the viewer uses.
export interface LibraryItem {
  id: string;
  name: string;
  file: string;
  texture: string;
  thumb: string;
  height?: number;
  size?: number;
}

export interface ModelLibrary {
  characterFolder?: string;
  characters?: LibraryItem[];
  props?: { name: string; items: LibraryItem[] }[];
}

export interface ModelInfo {
  id: string;
  name: string;
  // Image reference (see imageUrl). Empty means "draw a coloured cylinder".
  src: string;
  textureRepeat: [number, number];
  textureOffset: [number, number];
  size: number;
  scale: number;
  modelOffset: [number, number];
  viewDistance: number;
  baseColor: number;
}

// The login token, or a function returning one. A function is called before EVERY connection
// attempt (including reconnects), so a short-lived token can be fetched fresh each time.
// The function receives the room about to be joined (it changes when the user moves to another room).
export type TokenSource = string | ((join: { roomId: string }) => string | Promise<string>);

export interface SideButtonOptions {
  name: string;
  title: string;
  icon: string;
  help?: string;
  hostOnly?: boolean;
  onClick: () => void;
}

export interface TabletopOptions {
  serverUrl?: string;
  token?: TokenSource;
  roomId?: string;
  demo?: boolean;
  assetBaseUrl?: string;
  imageUrl?: (request: ImageRequest) => string;
  avatarUrl?: (user: UserInfo) => string;
  uploadModel?: (formData: FormData) => Promise<unknown>;
  uploadPlane?: (formData: FormData) => Promise<unknown>;
  inviteLink?: (code: string) => string;
  trackerUrl?: string;
  // Draws an initiative tracker (or anything else) into the side drawer the Tracker button opens,
  // once, the first time it opens. Wins over trackerUrl (which frames a page instead).
  mountTracker?: (element: HTMLElement) => void;
  // Extra buttons for the side rail, below the built-in ones (for example a dice roller).
  // `icon` is a Material Icons ligature name; `help` is the line shown in the tooltip and Help.
  buttons?: SideButtonOptions[];
  // Room messages the host app handles itself (for example shared dice rolls): incoming updates
  // with these names go to onAppEvent instead of the viewer; send them with tabletop.sendAppEvent.
  appEvents?: string[];
  onAppEvent?: (name: string, args: Record<string, unknown>, from: string | undefined) => void;
  // Built-in 3D models (see model-library.js). `file`, `texture` and `thumb` are relative to
  // `assetBaseUrl`. A character's `height` and a prop's `size` (its longest side) are in grid squares.
  modelLibrary?: ModelLibrary;
  resolveModel?: (
    modelId: string,
  ) => ModelInfo | null | undefined | Promise<ModelInfo | null | undefined>;
  skybox?: SkyboxOptions;
  // A picture for the walls (see wall-texture.js): `src` is relative to `assetBaseUrl` unless it is
  // an absolute URL or data URI; one tile covers `tileSize` world units (default 2).
  wallTexture?: { src: string; tileSize?: number };
  // A 3D model for the walls (glTF, see wall-model.js), used instead of the plain boxes: one copy
  // per tile of about `tileWidth` world units (default 1), stretched to fill each wall exactly and
  // to the wall height. `src` resolves like wallTexture's. Doors still cut openings.
  wallModel?: { src: string; tileWidth?: number };
  // The big word on the loading screen (default "Tabletop").
  loadingTitle?: string;
  // Offline demo only: the room to show instead of the built-in two-room building. Same shape as
  // the object createDemoRoom() returns (see demo.ts): name, dm, daylight, grid, clients, tokens,
  // planes, doors, wallPoints, models. It is copied, never modified.
  demoRoom?: Record<string, unknown>;
  focus?: object;
  debug?: boolean;
  // Test hooks.
  WebSocketImpl?: unknown;
}

export interface SkyboxOptions {
  day?: { path: string; extension?: string };
  night?: { path: string; extension?: string };
}

export interface ResolvedOptions extends TabletopOptions {
  serverUrl: string;
  token: TokenSource;
  roomId: string;
  demo: boolean;
  assetBaseUrl: string;
  imageUrl: (request: ImageRequest) => string;
  avatarUrl: (user: UserInfo) => string;
}

function joinUrl(base: string, path: string): string {
  if (!base) return path;
  return base.replace(/\/+$/, '') + '/' + path.replace(/^\/+/, '');
}

export function joinAssetUrl(assetBaseUrl: string, path: string): string {
  return joinUrl(assetBaseUrl, path);
}

// Default image location: absolute URLs and data URIs are used as they are, anything else is a
// file name under <assetBaseUrl>/images/models or /images/planes.
export function makeDefaultImageUrl(assetBaseUrl: string) {
  return function defaultImageUrl(request: ImageRequest): string {
    const src = String(request.src);
    if (/^(https?:|data:|blob:|\/)/i.test(src)) return src;
    return joinUrl(
      assetBaseUrl,
      `images/${request.kind === 'model' ? 'models' : 'planes'}/${encodeURIComponent(src)}`,
    );
  };
}

// A round avatar drawn locally (no network request): the user's initial on a colour from their id.
export function defaultAvatarUrl(user: UserInfo): string {
  let hash = 0;
  const id = String(user.userId);
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  const initial = (String(user.name || user.userId).trim()[0] || '?')
    .toUpperCase()
    .replace(/[<>&"']/g, '?');
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="hsl(${hue},45%,40%)"/>` +
    `<text x="32" y="43" font-size="32" text-anchor="middle" fill="white" font-family="sans-serif">${initial}</text></svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

function defaultServerUrl(): string {
  if (typeof location === 'undefined') return 'ws://localhost:3000';
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${location.hostname}:3000`;
}

// Per-tab random token so a reconnect (or reload) keeps the same identity when the host app
// gives none. sessionStorage, so two tabs are two different users.
function generatedToken(): string {
  const key = 'tabletop-token';
  try {
    const saved = sessionStorage.getItem(key);
    if (saved) return saved;
    const fresh = 'guest-' + Math.random().toString(36).slice(2, 10);
    sessionStorage.setItem(key, fresh);
    return fresh;
  } catch {
    return 'guest-' + Math.random().toString(36).slice(2, 10);
  }
}

export function resolveOptions(user: TabletopOptions = {}): ResolvedOptions {
  const assetBaseUrl = user.assetBaseUrl || '';
  return {
    ...user,
    serverUrl: user.serverUrl || defaultServerUrl(),
    token: user.token !== undefined ? user.token : generatedToken(),
    roomId: user.roomId || 'default',
    demo: !!user.demo,
    assetBaseUrl,
    imageUrl: user.imageUrl || makeDefaultImageUrl(assetBaseUrl),
    avatarUrl: user.avatarUrl || defaultAvatarUrl,
  };
}
