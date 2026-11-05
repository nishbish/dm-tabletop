// Local test page. Query parameters:
//   ?server=ws://localhost:3000   websocket address (default: this host, port 3000)
//   &room=table1                  room id (default "default")
//   &token=alice                  who you are (default: random per tab); the first one in is host
//   &demo=1                       offline demo, no server needed
//   &wallModel=walls/wall.gltf    draw the walls with this glTF model
//   &title=Dungeons               the loading screen's title
//   &library=1                    (with demo=1) a small token and map library with badges, and a
//                                 locked upload button that has one too
import { createTabletop } from '../src/index.js';

const params = new URLSearchParams(location.search);

window.tabletop = createTabletop(document.getElementById('app'), {
  serverUrl: params.get('server') || undefined,
  roomId: params.get('room') || undefined,
  token: params.get('token') || undefined,
  demo: params.get('demo') === '1',
  debug: true,
  // Pretend a tracker exists so the side button can be seen; remove to hide it.
  trackerUrl: params.get('tracker') || undefined,
  wallModel: params.get('wallModel') ? { src: params.get('wallModel') } : undefined,
  loadingTitle: params.get('title') || undefined,
  ...(params.get('library') === '1' ? badgedLibrary() : {}),
});

// A tiny library for trying `badge` and `uploadBadge` (and the browser test that checks them).
function badgedLibrary() {
  return {
    uploadBadge: 'Silver',
    uploadLocked: { title: 'Uploads', description: 'Uploads are locked on this page.' },
    demoLibrary: async (kind) => {
      const folders = [
        { folderId: 'f-free', parentId: 0, name: 'Free' },
        { folderId: 'f-paid', parentId: 0, name: 'Paid', badge: 'Gold' },
      ];
      const items = [{ name: 'Plain' }, { name: 'Shiny', badge: 'Silver' }];
      const reply = { folders, folderId: 0, parentId: 0, showNext: false };
      if (kind === 'plane')
        reply.planes = items.map((x, i) => ({ ...x, planeUploadId: 'p' + i, src: 'p' + i }));
      else reply.models = items.map((x, i) => ({ ...x, modelId: 'm' + i, src: 'm' + i }));
      return reply;
    },
  };
}
