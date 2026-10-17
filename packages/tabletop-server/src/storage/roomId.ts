// Room ids end up in file names and SQL keys, so we only allow a boring character set.
// No dots or slashes means "../x" and absolute paths can never be expressed.
const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export function isValidRoomId(id: unknown): boolean {
  return typeof id === 'string' && ROOM_ID_PATTERN.test(id);
}

export function assertValidRoomId(id: unknown): string {
  if (!isValidRoomId(id)) {
    throw new Error('invalid room id');
  }
  return id as string;
}
