// Local test page. Query parameters:
//   ?server=ws://localhost:3000   websocket address (default: this host, port 3000)
//   &room=table1                  room id (default "default")
//   &token=alice                  who you are (default: random per tab); the first one in is host
//   &demo=1                       offline demo, no server needed
//   &wallModel=walls/wall.gltf    draw the walls with this glTF model
//   &title=Dungeons               the loading screen's title
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
});
