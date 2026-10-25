// Ported from the original single-file client. The whole client lives inside createTabletop() so
// that nothing leaks into the page's global scope (the original relied on globals set by the
// hosting page: login token, room ids, demo flag...). Those now come from `options`.
//
// Changes to the original logic are marked with "NOTE(port)" comments explaining why.
import './style.css';
import './context-menu.css';
import iconFontUrl from 'material-icons/iconfont/material-icons.woff2?url';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { SelectionBox } from 'three/examples/jsm/interactive/SelectionBox.js';
import { SelectionHelper } from 'three/examples/jsm/interactive/SelectionHelper.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutlinePass } from 'three/examples/jsm/postprocessing/OutlinePass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { TGALoader } from 'three/examples/jsm/loaders/TGALoader.js';

import { ContextMenu } from './context-menu.js';
import { TranslateControls } from './TranslateControls.js';
import { RotationControls } from './RotationControls.js';
import { ScaleControls } from './ScaleControls.js';
import { MouseHover } from './MouseHover.js';
import { resolveOptions } from './config';
import { createConnection } from './connection';
import { swatchUrl } from './models';
import { createDemoRoom } from './demo';
import { createSkyboxMaterials } from './skybox';
import { createFog } from './fog';
import { addWallUvs, createWallMaterial, wallTileSize } from './wall-texture';
import { showToast, createBanner, escapeHtml, hasWebGL } from './ui';
import * as walls from './walls';
import { DOOR_SIZE, getDoorParts } from './doors.js';

// NOTE(port): three.js >= r152 changed colour management and r155 changed light units. The
// original was written for r131, where colours were used as-is and light intensity was not
// divided by pi. We keep the old look: no colour management, linear output, and light
// intensities multiplied by pi (see lightLevel()).
THREE.ColorManagement.enabled = false;
const LIGHT_SCALE = Math.PI;

// Only the regular "Material Icons" face is needed (the package css would pull in five more).
function installIconFont() {
	if (document.getElementById('dmt-icon-font')) { return; }

	var style = document.createElement('style');
	style.id = 'dmt-icon-font';
	style.textContent = '@font-face { font-family: "Material Icons"; font-style: normal; font-weight: 400; font-display: block; src: url("' + iconFontUrl + '") format("woff2"); }' +
		'.material-icons { font-family: "Material Icons"; font-weight: normal; font-style: normal; font-size: 24px; line-height: 1; letter-spacing: normal; text-transform: none; display: inline-block; white-space: nowrap; word-wrap: normal; direction: ltr; -webkit-font-smoothing: antialiased; font-feature-settings: "liga"; }';
	document.head.appendChild(style);
}

// How strong the fog is in the host's translucent view (players always see it at full strength).
const DM_FOG_OPACITY = 0.6;

export function createTabletop(container, userOptions) {
const options = resolveOptions(userOptions);
installIconFont();
if (!hasWebGL()) {
	var unsupportedMessage = document.createElement('div');
	unsupportedMessage.className = 'dmt-unsupported';
	unsupportedMessage.textContent = 'This viewer needs WebGL, which your browser or device does not provide.';
	container.appendChild(unsupportedMessage);

	return { destroy: function() { unsupportedMessage.remove(); }, getSceneStats: function() { return null; }, getTokenPosition: function() { return null; } };
}

const demo = options.demo;
const dev = !!options.debug;
// Camera to move to once the room has loaded (set when switching rooms).
let focus = options.focus ? Object.assign({}, options.focus) : {};

// The root element everything (canvas, panes, menus) is added to.
const root = document.createElement('div');
root.className = 'dmt-root';
container.appendChild(root);
const cleanups = [];

function viewWidth() { return root.clientWidth || window.innerWidth; }
function viewHeight() { return root.clientHeight || window.innerHeight; }
// Pointer position (client coordinates) to normalised device coordinates of the canvas.
function ndcX(clientX) { var r = map.canvas.getBoundingClientRect(); return ((clientX - r.left) / r.width) * 2 - 1; }
function ndcY(clientY) { var r = map.canvas.getBoundingClientRect(); return -((clientY - r.top) / r.height) * 2 + 1; }
function byId(id) { return root.querySelector('#' + CSS.escape(id)); }
function listen(target, type, fn, opts) {
	target.addEventListener(type, fn, opts);
	cleanups.push(function() { target.removeEventListener(type, fn, opts); });
}
function lightLevel(value) { return value * LIGHT_SCALE; }

// Temporary ids for objects the server has not numbered yet, and group ids chosen by the client.
let localIdCounter = 0;
function newLocalId() {
	localIdCounter++;
	return 'l' + Date.now().toString(36) + localIdCounter.toString(36) + Math.random().toString(36).slice(2, 5);
}

// Non-blocking message (replaces alert()).
function notify(message, level) {
	showToast(root, message, level || 'info');
}

var clock = new THREE.Clock();
var mixer;

var sessionId = 0;
var user_id;
var isDM = demo ? true : false;

var parseData = {
	int: function(value) {
			return parseInt(value);
	},
	float: function(value) {
			return parseFloat(value);
	},
	// NOTE(port): ids (tokens, planes, users...) are opaque strings in protocol v2. The original
	// forced integers, or stripped "unusual" characters from user ids, which would break
	// ownership checks for ids like email addresses or UUIDs.
	id: function(value) {
		return String(value);
	},
	// free text (names, urls): not sanitised here, always inserted with textContent / escapeHtml
	text: function(value) {
		return String(value);
	},
	string: function(value) {
		return String(value).replace(/[^0-9a-zA-Z_\-\. ]/gi, '');
	},
}

//default map
const map = {
	objects: {
		tokens: {},
		planes: {},
		doors: {}
	},
	local: {
		animating: true,
		dmLight: 1,
		daylight: 0,
		planeListOffset: 0,
		planeListLimit: 24,
		tokenListOffset: 0,
		tokenListLimit: 24,
		tokenVisionActive: false,
		verticalTranslate: false,
		tokenFormDefault: {
			name: '',
			id: '',
			textureRepeatX: 1,
			textureRepeatY: 1,
			textureOffsetX: 0,
			textureOffsetY: 0,
			size: 1,
			scale: 1,
			modelOffsetX: 0,
			modelOffsetY: 0,			
			baseColor: '#000000',
			viewDistance: 60
		}
	},
	users: {},
	arrows: [],
	panes: {},
	sideButtons: {},
	menus: {},
	menuTarget: null,
	lastClickPos: null,
	loaded: false,
	loadScreen: null,
	loadItemCount: null,		
	wallPointGroupActive: false,
	wallPointGroups: {},	
	// wall mode tool: 'points' (click to place), 'room' or 'corridor' (drag out)
	wallTool: 'points',
	wallDrag: null,
	// true while a full room state is loading: walls are built once at the end, not per point
	deferWalls: false,
	ghost: null,
	toggleMode: 'token',
	selectModeActive: false,
	models: {},
	groupSelectObject: [],
	translateControls: {},
	rotationControls: {},
	scaleControls: {},
	pointer: new THREE.Vector2(),
	pointerWhich: 0,
	settings: {
		preset: mobileAndTabletCheck() ? 1 : 2,
		lightingQuality: 2,
		snapLighting: true,
		snapTokenPos: true,
		maskPoints: 160,
		renderFactor: 100,
		maxTokenTextureSize: 1024,
		maxTokenTextureQuality: 8,
		maxPlaneTextureSize: 4096,
		maxPlaneTextureQuality: 80,
		viewDistance: 500,
		fov: 36,
		cameraDamping: 1,
		dragUpdate: 1,
		lookAtCam: 1,
		gridWidth: 100,
		gridHeight: 100
	}
}

// NOTE(port): the original embedded a demo room that referenced uploaded images. The demo is
// now generated procedurally, see demo.js.
map.defaultRoom = createDemoRoom();

loadSettings();

// Quick inspection from the console / tests: createTabletop(el, {debug: true}).debug.map

//context menu
map.menus.default = new ContextMenu( {
	  'parent': root,
	  'theme': 'default',
	  'items': getDefaultItems()
  }
);

map.menus.defaultPlaneImage = new ContextMenu( {
	  'parent': root,
	  'theme': 'default',
	  'items': getDefaultItems(true)
  }
);

// NOTE(port): "Edit" opens the token upload form, so it only exists when the host app supplies
// an uploadModel() hook. (The original also built an unused "tokenChoice" menu, dropped.)
var tokenMenuItems = [
	{'icon': 'person_add', 'name': 'Enlarge',  action: (e) => resizeToken(e, 1)  },
	{'icon': 'person_remove', 'name': 'Shrink',  action: (e) => resizeToken(e, -1)  },
];
if (options.uploadModel) {
	tokenMenuItems.push({'icon': 'edit', 'name': 'Edit',  action: (e) => editModel(e)  });
}
tokenMenuItems.push(
	{'icon': 'assignment_ind', 'name': 'Assign Token',  action: (e) => assignTokenMenu(e)  },
	{'icon': 'remove_circle', 'name': 'Remove Token',  action: (e) => removeToken(e)  },
	{'icon': 'tune', 'name': 'Settings',  action: (e) => openTokenSettings(e)  }
);

map.menus.token = new ContextMenu( {
	  'parent': root,
	  'theme': 'default',
	  'items': tokenMenuItems
  }
);

map.menus.door = new ContextMenu( {
    'parent': root,
    'theme': 'default',
      'items': [
        {'icon': 'remove_circle', 'name': 'Remove Door',  action: (e) => removeDoor()  },
      ]
  }
);

map.menus.wallPoint = new ContextMenu( {
    'parent': root,
    'theme': 'default',
      'items': [
        {'icon': 'remove_circle', 'name': 'Remove Wall',  action: (e) => removeWallPoint()  },
      ]
  }
);

function getDefaultItems(planeImage = false) {
	var items = [
		{'icon': 'person_add_alt_1', 'name': 'Add Token',  action: (e) => addToken(e)  },
		{'icon': 'add_photo_alternate', 'name': 'Add Image',  action: (e) => addPlaneImage(e)  }
	];
	
	if (planeImage) {
		items.push({'icon': 'hide_image', 'name': 'Remove Image',  action: (e) => removePlaneImage(e)  });
	}
	
	return items;
}

function getUserDetailItems() {
	hideContextMenu();
	var items = [];
	
	if ('users' in map) {
		//remove duplicates
		var users = map.users;
		
		for (const [user_id, user] of Object.entries(users)) {
			items.push({'thumb': map.users[user_id].picture, 'name': map.users[user_id].name, data: user_id,  action: (e) => assignToken(e) });	
		}
	}
	
	return items;
}

var prevCollisions = [];

function init() {
	map.renderer = new THREE.WebGLRenderer({
		antialias: true,
		powerPreference: 'high-performance'
	});

	// NOTE(port): see the colour management note at the top of the file.
	map.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
	map.renderer.setClearColor( 0x444444, 1 );
	
	map.renderer.setPixelRatio( window.devicePixelRatio );
	map.renderer.setSize( viewWidth() * (map.settings.renderFactor / 100), viewHeight() * (map.settings.renderFactor / 100) );
	map.canvas = map.renderer.domElement;
	
	map.canvas.style.width = viewWidth() + 'px';
	map.canvas.style.height = viewHeight() + 'px';

	listen(root, 'contextmenu', defaultContextMenu, false);
	
	map.canvas.addEventListener("pointerdown", canvasCheck, false);
	map.canvas.addEventListener("pointermove", canvasMove, false);
	map.canvas.addEventListener("pointerup", canvasClick, false);
	map.canvas.addEventListener("pointerleave", function() { ghostPointer = null; scheduleGhosts(); }, false);

	root.appendChild(map.canvas);

	map.scene = new THREE.Scene();

	map.objects.camera = new THREE.PerspectiveCamera( map.settings.fov, viewWidth() / viewHeight(), 1, map.settings.viewDistance );

	//composer
	map.composer = new EffectComposer( map.renderer );

	map.renderPass = new RenderPass( map.scene, map.objects.camera );
	map.composer.addPass( map.renderPass );

	//outline pass
	map.outlinePass = new OutlinePass( new THREE.Vector2( viewWidth(), viewHeight() ), map.scene, map.objects.camera );
	map.outlinePass.visibleEdgeColor.setHex(0xffffff);
	map.outlinePass.hiddenEdgeColor.setHex(0x272727);
	map.outlinePass.edgeGlow = 0;
	map.outlinePass.edgeThickness = 1;
	map.outlinePass.edgeStrength = 10;

	map.composer.addPass( map.outlinePass );

	//ping
	map.ping = initPing();
	
	//orbit controls
	map.orbitControls = new OrbitControls(map.objects.camera, map.canvas);
	map.orbitControls.addEventListener('change', render);
	map.orbitControls.minDistance = 5;
	map.orbitControls.maxDistance = 5000;
	map.orbitControls.enablePan = true;
	map.orbitControls.enableDamping = map.settings.cameraDamping ? true : false;
	map.orbitControls.dampingFactor = 0.05;
	map.orbitControls.maxPolarAngle = Math.PI / 2;
	map.orbitControls.panSpeed = 1.4;
	map.orbitControls.endTimer = null;
	
	map.orbitControls.addEventListener('start', function() {
		map.orbitControls.animating = false;
	});

	map.orbitControls.addEventListener('change', function() {
		if (map.objects.camera.position.y < 2.1) {
			map.objects.camera.position.y = 2.1;
		}

		//move skybox to camera pos
		map.skybox.position.copy(map.objects.camera.position);
	});

	map.orbitControls.mouseButtons = {
		LEFT: THREE.MOUSE.PAN,
		RIGHT: THREE.MOUSE.ROTATE,
		MIDDLE: THREE.MOUSE.DOLLY
	}

	map.orbitControls.touches.ONE = THREE.TOUCH.PAN;
	map.orbitControls.touches.TWO = THREE.TOUCH.DOLLY_ROTATE;	

	// NOTE(port): newer three.js no longer listens to the keyboard unless asked to (and uses
	// string key names, whose defaults are the arrow keys we want).
	map.orbitControls.listenToKeyEvents(window);
	map.orbitControls.keyPanSpeed = 15;

	//modifier key
	var ctrlPressed = false;
	var shiftPressed = false;

	listen(document, 'keydown', function(e) {
	  if (isBuildMode() && !isTyping(e)) {
	  	if (e.key === 'Escape' && map.toggleMode == 'wallPoint') {
	  		map.wallDrag = null;
	  		finishWall();
	  	}

	  	if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
	  		e.preventDefault();
	  		undo();
	  		return;
	  	}
	  }

	  if (e.ctrlKey) {
	    ctrlPressed = true;
	  }

	  if (e.shiftKey) {
	  	shiftPressed = true;

			if (!map.selectModeActive && map.sideButtons.selectMode) {
				map.sideButtons.selectMode.element.click();
			}
	  }
	});

	listen(document, 'keyup', function(event) {
		var char = event.which || event.keyCode;

    if (char == 17) {
	    ctrlPressed = false;
	  }

    if (char == 16) {
    	shiftPressed = false;

			if (map.selectModeActive && map.sideButtons.selectMode) {
				map.sideButtons.selectMode.element.click();
			}
    }
	});

	map.selectionBox = new SelectionBox( map.objects.camera, map.scene );
	// NOTE(port): the helper's constructor changed; it is only active while select mode is on.
	map.selectionHelper = new SelectionHelper( map.renderer, 'selectBox' );
	map.selectionHelper.enabled = false;

	//ambient light
	map.objects.light = new THREE.HemisphereLight( 0xffffff, 0x777777, lightLevel(1) );
	map.scene.add(map.objects.light);

	//skybox	
	const skyboxGeo = new THREE.BoxGeometry();
	// NOTE(port): the original loaded photographic skybox images shipped with the site. Those are
	// not redistributable, so by default we draw a plain gradient sky. A host app can point
	// options.skybox at its own six-face images (see skybox.js).
	const skyboxMaterials = createSkyboxMaterials(THREE, TGALoader, options);
	const skyboxMaterialsDay = skyboxMaterials.day;
	const skyboxMaterialsNight = skyboxMaterials.night;
    map.skybox = new THREE.Mesh(skyboxGeo, skyboxMaterialsDay);
	map.skybox.dayMats = skyboxMaterialsDay;
	map.skybox.nightMats = skyboxMaterialsNight;
	map.skybox.scale.set(map.settings.viewDistance, map.settings.viewDistance, map.settings.viewDistance);
    map.scene.add(map.skybox);

	//plane
	var material = new THREE.MeshStandardMaterial( { color: 0xcbcbcb, dithering: true } );
	var geometry = new THREE.PlaneGeometry( map.settings.gridWidth, map.settings.gridHeight);

	map.objects.plane = new THREE.Mesh(geometry, material);
	map.objects.plane.position.set((map.settings.gridWidth / 2) - 0.5, -0.53, (map.settings.gridHeight / 2) - 0.5);
	map.objects.plane.rotation.x = - Math.PI * 0.5;
	map.objects.plane.name = 'plane';
	map.scene.add(map.objects.plane);
	
	//arrow
	for (var i=0;i<map.settings.maskPoints;i++) {
		var arrow = new THREE.ArrowHelper(new THREE.Vector3(0,0,0).normalize(), new THREE.Vector3(0,0,0), 0, 0xfc0303, 0, 0);
		arrow.visible = false;
		map.scene.add(arrow);
		map.arrows.push(arrow);
	}

	//grid	
	updateGridSize(false);

	var camPos = {
		x: 0,
		y: 12,
		z: 0
	}

	map.objects.camera.position.copy(new THREE.Vector3(camPos.x + 2, camPos.y, camPos.z + 12));
	map.orbitControls.target = new THREE.Vector3(camPos.x, 0, camPos.z);

	map.orbitControls.update();

	// NOTE(port): watch the container, not just the window, so embedding in a resizable element works.
	if (typeof ResizeObserver !== 'undefined') {
		resizeObserver = new ResizeObserver(onResize);
		resizeObserver.observe(root);
	}
	listen(window, 'resize', onResize, false);

	//hover controls
	map.hover = new MouseHover(map.objects.camera, map.canvas, map.renderer);

	map.hover.hoverchange = function(e) {

		if (map.toggleMode in map.translateControls) {
			var controls = map.translateControls[map.toggleMode];

			var selected = [];
			root.style.cursor = 'default';

			for (var i=0;i<controls.translateGroupObjects.length;i++) {
				var selectObject = controls.translateGroupObjects[i];
				if ('hoverTarget' in selectObject) { selectObject = selectObject.hoverTarget; }

				if (!(selected.includes(selectObject)) && (isDM || (!isDM && selectObject.name == 'base' && checkTokenOwner(selectObject.token)))) {
					selected.push(selectObject);
				}
			}

			var hoverObject = e.object;

			if ('dmSelectable' in hoverObject) { hoverObject = hoverObject.dmSelectable; }
			if ('translateParent' in hoverObject) { hoverObject = hoverObject.translateParent; }
			if ('hoverTarget' in hoverObject) { hoverObject = hoverObject.hoverTarget; }			

			if (e.type == 'hoveron') {
				var validObjects = [];

				if (!(selected.includes(hoverObject))) {
					if (controls.translateObjects.includes(hoverObject) && (isDM || (!isDM && hoverObject.name == 'base' && checkTokenOwner(hoverObject.token)))) {
						root.style.cursor = 'pointer';
						selected.push(hoverObject);
					}
					else {
						for (var i=0;i<controls.translateObjects.length;i++) {
							if (controls.handles.length > 0) {
								for (var j=0;j<controls.handles.length;j++) {
									if (controls.handles[j] in controls.translateObjects[i]) {
										validObjects.push(controls.translateObjects[i][controls.handles[j]]);
									}
								}
							}
							else {
								validObjects.push(controls.translateObjects[i]);
							}
						}

						if (validObjects.includes(hoverObject) && (isDM || (!isDM && hoverObject.name == 'base' && checkTokenOwner(hoverObject.token)))) {
							root.style.cursor = 'pointer';
							selected.push(hoverObject);
						}
					}
				}
			}

			map.outlinePass.selectedObjects = selected;
		}
	}

	map.hover.addEventListener('hoveron', map.hover.hoverchange, false);
	map.hover.addEventListener('hoveroff', map.hover.hoverchange, false);

	//door translate controls
	map.translateControls.door = new TranslateControls(map.objects.camera, map.canvas, map.scene, map.renderer);
	map.translateControls.door.handles = ['frame', 'panel'];
	map.translateControls.door.enabled = false;

	//door translatestart
	map.translateControls.door.translatestart = function(e) {
		if (map.toggleMode == 'door') {
			map.orbitControls.enablePan = false;
			//walls do not change while a door is dragged, so find them once
			map.dragWallSegments = allWallSegments();
			map.dragUndo = doorTransforms(map.translateControls.door.translateGroupObjects);
		}
	}
	
	map.translateControls.door.addEventListener('translatestart', map.translateControls.door.translatestart, false);

	//door translate
	map.translateControls.door.translate = function(e) {
		
		if (map.toggleMode == 'door') {
			map.outlinePass.selectedObjects = [];
			var moved = false;

			for (var h=0;h<map.translateControls.door.translateGroupObjects.length;h++) {
				var door = map.translateControls.door.translateGroupObjects[h];
				
				if (!map.outlinePass.selectedObjects.includes(door)) {
					map.outlinePass.selectedObjects.push(door);
				}

				var pos = new THREE.Vector3(
					Math.round(door.position.x * 2) / 2,
					Math.round(door.position.y * 2) / 2,
					Math.round(door.position.z * 2) / 2
				);

				//a single door slides along the wall it is dragged next to
				if (map.translateControls.door.translateGroupObjects.length == 1) {
					var snap = walls.snapDoorToWalls(door.position.x, door.position.z, map.dragWallSegments || [], door.size.width, door.rotation.y);

					if (snap) {
						pos.x = snap.x;
						pos.z = snap.z;
						door.rotation.y = snap.rotation;
					}
				}
				
				var prevPos = door.prevPos.clone();
				
				door.position.copy(pos);			

				if (!pos.equals(prevPos)) {
					door.prevPos = pos;
					moved = true;
				}
			}

			//only walls whose opening changed are rebuilt
			if (moved) { rebuildWalls(); }

			map.rotationControls.door.updatePosition();
		}
	}

	map.translateControls.door.addEventListener('translate', map.translateControls.door.translate, false);
	
	//door translateend
	map.translateControls.door.translateend = function(e) {
		if (map.toggleMode == 'door') {
			updateTokenVision();
			map.orbitControls.enablePan = true;

			for (var h=0;h<map.translateControls.door.translateGroupObjects.length;h++) {
				sendDoorTransform(map.translateControls.door.translateGroupObjects[h]);
			}

			pushTransformUndo(map.dragUndo);
			map.dragUndo = null;
			map.dragWallSegments = null;
		}
	}
	
	map.translateControls.door.addEventListener('translateend', map.translateControls.door.translateend, false);


	//rotation controls
	var rotationSettings = {
		radius: 1.4,
		thickness: 0.4
	}

	map.rotationControls.door = new RotationControls(map.objects.camera, map.canvas, map.scene, map.renderer, rotationSettings);
	map.rotationControls.door.snap = Math.PI / 8;
	map.rotationControls.door.axis = 'y';
	map.rotationControls.door.offset = new THREE.Vector3(0, -1, 0);

	//rotate start
	map.rotationControls.door.rotatestart = function(e) {
		if (map.toggleMode == 'door') {
			map.orbitControls.enablePan = false;
			map.translateControls.door.enabled = false;
			map.dragUndo = doorTransforms([map.rotationControls.door.object]);
		}
	}

	map.rotationControls.door.addEventListener('rotatestart', map.rotationControls.door.rotatestart, false);


	//rotate end
	map.rotationControls.door.rotateend = function(e) {

		if (map.toggleMode == 'door') {
			updateTokenVision();
			map.orbitControls.enablePan = true;
			map.translateControls.door.enabled = true;

			var door = map.rotationControls.door.object;
			clearGroupSelection();

			if (door.doorId in map.objects.doors) {
				rebuildWalls();
				sendDoorTransform(door);
				pushTransformUndo(map.dragUndo);
			}

			map.dragUndo = null;
		}
	}

	map.rotationControls.door.addEventListener('rotateend', map.rotationControls.door.rotateend, false);

	//wall point transform controls
	map.translateControls.wallPoint = new TranslateControls(map.objects.camera, map.canvas, map.scene, map.renderer);
	map.translateControls.wallPoint.enabled = false;

	//wall point translatestart
	map.translateControls.wallPoint.translatestart = function(e) {
		if (map.toggleMode == 'wallPoint') {
			map.orbitControls.enablePan = false;
			addJoinedWallPoints(map.translateControls.wallPoint);
			map.dragUndo = wallPointPositions(map.translateControls.wallPoint.translateGroupObjects);
		}
	}
	
	map.translateControls.wallPoint.addEventListener( 'translatestart', map.translateControls.wallPoint.translatestart, false);
	

	//wall point translate
	map.translateControls.wallPoint.translate = function(e) {

		if (map.toggleMode == 'wallPoint') {
			map.outlinePass.selectedObjects = [];
			//each wall is rebuilt once per move, and only when a point crossed to a new spot
			var movedGroups = new Set();

			for (var h=0;h<map.translateControls.wallPoint.translateGroupObjects.length;h++) {
				var wallPoint = map.translateControls.wallPoint.translateGroupObjects[h];
				
				if (!map.outlinePass.selectedObjects.includes(wallPoint)) {
					map.outlinePass.selectedObjects.push(wallPoint);
				}

				if (wallPoint.wallPointGroupId in map.wallPointGroups) {
					if (wallPoint.wallPointId in map.wallPointGroups[wallPoint.wallPointGroupId].points) {
						var pos = new THREE.Vector3(
							Math.round(wallPoint.position.x * 2) / 2,
							Math.round(wallPoint.position.y * 2) / 2,
							Math.round(wallPoint.position.z * 2) / 2
						);
						
						var prevPos = new THREE.Vector3(
							Math.round(wallPoint.prevPos.x * 2) / 2,
							Math.round(wallPoint.prevPos.y * 2) / 2,
							Math.round(wallPoint.prevPos.z * 2) / 2
						);
						
						wallPoint.position.copy(pos);

						if (!pos.equals(prevPos)) {
							wallPoint.prevPos = pos;
							movedGroups.add(map.wallPointGroups[wallPoint.wallPointGroupId]);
						}
					}
				}
			}

			if (movedGroups.size > 0) {
				var doors = doorSpans();
				var joints = wallJoints();
				movedGroups.forEach(function(group) { updateWallGroup(group, doors, joints); });
			}
		}
	}

	map.translateControls.wallPoint.addEventListener('translate', map.translateControls.wallPoint.translate, false);
	
	//wall point translateend
	map.translateControls.wallPoint.translateend = function(e) {
		
		if (map.toggleMode == 'wallPoint') {
			rebuildWalls(true);		//corners may have joined or come apart
			updateVisionMeshes();
			updateTokenVision();

			map.orbitControls.enablePan = true;

			for (var h=0;h<map.translateControls.wallPoint.translateGroupObjects.length;h++) {
				var wallPoint = map.translateControls.wallPoint.translateGroupObjects[h];

				var args = {
					wallPointGroupId: wallPoint.wallPointGroupId,
					wallPointId: wallPoint.wallPointId,
					x: wallPoint.position.x,
					z: wallPoint.position.z
				};
				
				sendMessage('update', 'updateWallPoint', args);
			}

			pushTransformUndo(map.dragUndo);
			map.dragUndo = null;
		}
	}
	
	map.translateControls.wallPoint.addEventListener( 'translateend', map.translateControls.wallPoint.translateend, false);
	

	//translate controls
	map.translateControls.plane = new TranslateControls(map.objects.camera, map.canvas, map.scene, map.renderer);
	map.translateControls.plane.enabled = false;

	//translate start
	map.translateControls.plane.translatestart = function (e) {
		if (map.toggleMode == 'plane' && !map.selectModeActive) {
			map.orbitControls.enablePan = false;
		}
	}

	map.translateControls.plane.addEventListener('translatestart', map.translateControls.plane.translatestart, false);

	//translate
	map.translateControls.plane.translate = function (e) {
		if (map.toggleMode == 'plane') {
			map.rotationControls.plane.updatePosition();
			map.scaleControls.plane.updatePosition();

			map.outlinePass.selectedObjects = [];

			for (var h=0;h<map.translateControls.plane.translateGroupObjects.length;h++) {
				var plane = map.translateControls.plane.translateGroupObjects[h];

				if (!map.outlinePass.selectedObjects.includes(plane)) {
					map.outlinePass.selectedObjects.push(plane);
				}

				if (plane.planeId in map.objects.planes) {
					var args = {
						planeId: plane.planeId,
						posX: plane.position.x,
						posZ: plane.position.z,
						scaleX: plane.scale.x,
						scaleY: plane.scale.y,
						rotZ: plane.rotation.z
					};

					sendMessage('update', 'updatePlaneTransform', args);				
				}
			}
		}
	}

	map.translateControls.plane.addEventListener('translate', map.translateControls.plane.translate, false);


	//translate end
	map.translateControls.plane.translateend = function (e) {
		if (map.toggleMode == 'plane') {
			map.orbitControls.enablePan = true;
			map.rotationControls.plane.updatePosition();
			map.scaleControls.plane.updatePosition();
		}
	}

	map.translateControls.plane.addEventListener('translateend', map.translateControls.plane.translateend, false);


	//scale controls
	map.scaleControls.plane = new ScaleControls(map.objects.camera, map.canvas, map.scene, map.renderer);

	//scale start
	map.scaleControls.plane.scalestart = function(e) {
		if (map.toggleMode == 'plane') {
			map.orbitControls.enablePan = false;
			map.orbitControls.enableRotate = false;
			map.translateControls.plane.enabled = false;
			map.scaleControls.plane.uniform = !ctrlPressed;
		}
	}

	map.scaleControls.plane.addEventListener('scalestart', map.scaleControls.plane.scalestart, false);

	//scale
	map.scaleControls.plane.scale = function(e) {
		if (map.toggleMode == 'plane') {
			var plane = map.scaleControls.plane.object;	

			if (typeof(plane) != "undefined") {
				map.rotationControls.plane.updatePosition();
			}
		}
	}

	map.scaleControls.plane.addEventListener('scale', map.scaleControls.plane.scale, false);

	//scale end
	map.scaleControls.plane.scaleend = function(e) {
		if (map.toggleMode == 'plane') {
			map.orbitControls.enablePan = true;
			map.orbitControls.enableRotate = true;
			map.translateControls.plane.enabled = true;
			var plane = map.scaleControls.plane.object;
			clearGroupSelection();

			if (plane.planeId in map.objects.planes) {
				var args = {
					planeId: plane.planeId,
					posX: plane.position.x,
					posZ: plane.position.z,
					scaleX: plane.scale.x,
					scaleY: plane.scale.y,
					rotZ: plane.rotation.z
				};

				sendMessage('update', 'updatePlaneTransform', args);				
			}
		}
	}

	map.scaleControls.plane.addEventListener('scaleend', map.scaleControls.plane.scaleend, false);

	//rotation controls
	map.rotationControls.plane = new RotationControls(map.objects.camera, map.canvas, map.scene, map.renderer);

	//rotate start
	map.rotationControls.plane.rotatestart = function(e, plane = false) {
		if (map.toggleMode == 'plane') {
			map.orbitControls.enablePan = false;
			map.translateControls.plane.enabled = false;
		}
	}

	map.rotationControls.plane.addEventListener('rotatestart', map.rotationControls.plane.rotatestart, false);

	//rotate move
	map.rotationControls.plane.rotate = function(e) {
		
		if (map.toggleMode == 'plane') {
			var plane = map.rotationControls.plane.object;
			
			if (typeof(plane) != "undefined") {
				map.scaleControls.plane.updatePosition();

				//free rotate
				if (ctrlPressed) {
					map.rotationControls.plane.snap = 0;
				}
				else {
					map.rotationControls.plane.snap = Math.PI / 8;
					plane.scale.x = plane.scale.y;
				}
			}
		}
	}

	map.rotationControls.plane.addEventListener('rotate', map.rotationControls.plane.rotate, false);

	//rotate end
	map.rotationControls.plane.rotateend = function(e) {

		if (map.toggleMode == 'plane') {
			map.orbitControls.enablePan = true;
			map.translateControls.plane.enabled = true;

			var plane = map.rotationControls.plane.object;
			clearGroupSelection();

			if (typeof(plane) != 'undefined' && plane.planeId in map.objects.planes) {
				var args = {
					planeId: plane.planeId,
					posX: plane.position.x,
					posZ: plane.position.z,
					scaleX: plane.scale.x,
					scaleY: plane.scale.y,
					rotZ: plane.rotation.z
				};

				sendMessage('update', 'updatePlaneTransform', args);				
			}
		}
	}

	map.rotationControls.plane.addEventListener('rotateend', map.rotationControls.plane.rotateend, false);


	//token transform controls
	map.translateControls.token = new TranslateControls(map.objects.camera, map.canvas, map.scene, map.renderer);
	map.translateControls.token.enabled = map.toggleMode == 'token';
	map.translateControls.token.handles = ['base'];
	map.translateControls.token.enableVertical = true;

	//translate start
	map.translateControls.token.translatestart = function (e) {
		if (map.toggleMode == 'token' && map.translateControls.token.object != null) {
			if (!isDM && !checkTokenOwner(map.translateControls.token.object)) {
				map.translateControls.token.object = null;
			}
			else {
				map.orbitControls.enablePan = false;
				map.orbitControls.enableRotate = false;

				map.local.tokenVisionActive = map.translateControls.token.object;
			}
		}
	}

	map.translateControls.token.addEventListener('translatestart', map.translateControls.token.translatestart, false);

	//translate
  map.translateControls.token.translate = function(e) {
  	if (map.toggleMode == 'token' && map.translateControls.token.object !== null) {
			map.outlinePass.selectedObjects = [];

			for (var h=0;h<map.translateControls.token.translateGroupObjects.length;h++) {
				var token = map.translateControls.token.translateGroupObjects[h];
				
				if (!map.outlinePass.selectedObjects.includes(token.base)) {
					map.outlinePass.selectedObjects.push(token.base);
				}
				
				var origin = new THREE.Vector3(token.prevPos.x, 0, token.prevPos.z);
				var direction = new THREE.Vector3;
				direction = direction.subVectors(token.position, token.prevPos).normalize();

				var gridCheckSize = 1;
				var maxStandingSpace = 0.5;

				if (!isDM || (isDM && map.local.dmLight === 0)) {
					var collisionMeshes = [];

					//wall meshes
					for (const [wallPointGroupId, wallPointGroup] of Object.entries(map.wallPointGroups)) {
						collisionMeshes.push(wallPointGroup.mesh);
					}

					//door meshes
					for (const [doorId, door] of Object.entries(map.objects.doors)) {
						if (!door.open) {
							collisionMeshes.push(door.frame);
							collisionMeshes.push(door.panel);
						}
					}
					
					//x ray	
					var dimsRayCaster = new THREE.Raycaster();
					dimsRayCaster.set(origin, new THREE.Vector3(direction.x, 0, 0));
					var intersects = dimsRayCaster.intersectObjects(collisionMeshes, false);

					if (intersects.length > 0) {
						for (var i=0;i<intersects.length;i++) {
							if (intersects[i].distance <= gridCheckSize) {
								token.position.x = token.prevPos.x;
							}
							else if ((token.position.x * direction.x) > (intersects[i].point.x * direction.x)) {
								token.position.x = intersects[i].point.x - (maxStandingSpace * direction.x);
							}

							break;
						}
					}

					//z ray
					dimsRayCaster.set(origin, new THREE.Vector3(0, 0, direction.z));
					intersects = dimsRayCaster.intersectObjects(collisionMeshes, false);

					if (intersects.length > 0) {
						for (var i=0;i<intersects.length;i++) {
							if (intersects[i].distance <= gridCheckSize) {
								token.position.z = token.prevPos.z;
							}
							else if ((token.position.z * direction.z) > (intersects[i].point.z * direction.z)) {
								token.position.z = intersects[i].point.z - (maxStandingSpace * direction.z);
							}

							break;
						}
					}
				}
				//limit token pos to floor
				if (token.position.y < 0) { token.position.y = 0; }

				//limit token pos to ceiling
				if (token.position.y > 6) { token.position.y = 6; }

				if (map.settings.snapTokenPos) {
					snapPosition(token);
				}

				token.intPos.copy(token.position).roundToZero();

				if (!token.intPos.equals(token.prevIntPos)) {
					token.prevPos.copy(token.position);
					token.prevIntPos.copy(token.prevPos).roundToZero();				

					if (map.settings.dragUpdate && token.tokenId in map.objects.tokens) {
						sendTokenMovement(token);

						if (map.settings.snapLighting) {
							updateTokenVision();
						}
					}
				}

				if (!map.settings.snapLighting) {
					updateTokenVision();
				}
			}
		}
  }

  map.translateControls.token.addEventListener('translate', map.translateControls.token.translate, false);


  //translate end
	map.translateControls.token.translateend = function (e) {
		if (map.toggleMode == 'token') {
			if (map.local.verticalTranslate) {
				map.sideButtons.translateMode.element.click();
			}

			map.orbitControls.enablePan = true;
			map.orbitControls.enableRotate = true;
			var token = map.translateControls.token.object;

			snapPosition(token);
			updateTokenPlaceHolder(token);

			if (!map.settings.dragUpdate) {
				updateTokenVision();
			}
			
			//dragging stopped
			if (token.tokenId in map.objects.tokens) {
				sendTokenMovement(token);
			}
		}
	}

	map.translateControls.token.addEventListener('translateend', map.translateControls.token.translateend, false);

	//fog of war: a soft shader plane (fog.js); material.opacity is the strength, as it was for the box
	map.mask = { fog: createFog(map.settings.gridWidth, map.settings.gridHeight) };
	map.mask.mesh = map.mask.fog.mesh;
	map.mask.mesh.material.opacity = isDM ? DM_FOG_OPACITY : 1;
	map.scene.add(map.mask.mesh);

	if (demo) {
		var demoText = document.createElement('div');
		demoText.id = 'demo-text';
		demoText.textContent = 'DEMO';
		root.appendChild(demoText);
	}
}

function updateTokenPlaceHolder(token) {
	//update placeholder position
	var placeHolder = token.meshes.placeHolder;
	var newPos = new THREE.Vector3(token.position.x, (placeHolder.size / 2) - 0.5, token.position.z);
	placeHolder.position.copy(token.worldToLocal(newPos));
}

function updateVisionMeshes() {
	if (!map.loaded) { return false; }

	map.visionMeshes = [];

	//door meshes
	for (const [doorId, door] of Object.entries(map.objects.doors)) {
		map.visionMeshes.push(door.frame);
		map.visionMeshes.push(door.panel);
	}

	//wall meshes
	for (const [wallPointGroupId, wallPointGroup] of Object.entries(map.wallPointGroups)) {
		if (wallPointGroup.mesh !== false) {
			map.visionMeshes.push(wallPointGroup.mesh);
		}
	}

	//placeholder meshes
	for (const [tokenId, token] of Object.entries(map.objects.tokens)) {
		if ('meshes' in token && 'placeHolder' in token.meshes) {
			map.visionMeshes.push(token.meshes.placeHolder);
		}
	}
}

// NOTE(port): the original submitted a hidden form (full page load) to move to another room.
// Now we simply join the other room over the same connection; the scene is rebuilt from the
// state we receive, and `focus` (a camera position) is applied once it has loaded.
function changeRoom(roomId, focusCamera = false) {
	if (focusCamera !== false) {
		focus = Object.assign({}, focusCamera);
	}

	connection.switchRoom(String(roomId));
}

function tokenScaleReposition(token) {
	//update token offset on scale change
	var newPos = 0;
	
	if (token.scale.y > 2) {
		newPos = (0.5 / 2) + (token.meshes.baseThickness * (token.scale.y / 2));
	}
	else if (token.scale.y > 1) {
		newPos = (0.5 - token.meshes.baseThickness) / 2;
	}

	token.meshes.position.y = newPos;
}

function snapPosition(object) {
	var dims = ['x', 'y', 'z'];

	for (var i=0;i<dims.length;i++) {
		var rounded = Math.round(object.position[dims[i]]);

		if (parseInt(object.scale[dims[i]]) % 2 || dims[i] == 'y') { 		//if odd size
			object.position[dims[i]] = rounded;
		}
		else {
			object.position[dims[i]] = (object.position[dims[i]] - rounded) >= 0 ? rounded + 0.5 : rounded - 0.5;
		}
	}
}

function sendTokenMovement(token) {
	//send to server	
	var args = {
		tokenId: token.tokenId,
		x: token.position.x,
		y: token.position.y,
		z: token.position.z		
	};
	
	sendMessage('update', 'updateTokenPosition', args);
}

function updateTokenSettings(token) {
	//send to server
	var args = {
		tokenId: token.tokenId,
		...token.settings
	};
	
	sendMessage('update', 'updateTokenSettings', args);
}

function createToken(pos, scale, modelId, local = true, owners = [], tokenId = false, settings = {}) {
	if (!(modelId in map.models)) {
		return false;
	}

	//token
	var playerPos = new THREE.Vector3(pos.x, pos.y, pos.z);
	var token = new THREE.Group();
	token.name = 'token';
	token.toggleMode = 'token';
	token.modelId = modelId;
	token.owners = owners;
	token.position.set(playerPos.x, playerPos.y, playerPos.z);
	token.intPos = token.position.clone().roundToZero();
	token.prevPos = token.position.clone();
	token.prevIntPos = token.prevPos.clone().roundToZero();
	token.scale.set(scale.x, scale.y, scale.z);
	token.prevScale = new THREE.Vector3(1, 1, 1);
	token.modelName = map.models[modelId].name;
	token.settings = {
		hideAvatar: 0,
		disableCamLook: 0
	};

	//override default token settings
	// NOTE(port): the server sends booleans, the UI works with 0/1.
	for (const settingName in settings) {
		if (settings[settingName] === null) { continue; }
		token.settings[settingName] = settings[settingName] ? 1 : 0;
	}
	
	if (!isDM) {
		token.visible = false;
	}

	if (!tokenId) {
		tokenId = newLocalId();
	}

	token.tokenId = tokenId;
	
	//send to server
	if (local) {
		var args = {
			x: playerPos.x,
			y: playerPos.y,
			z: playerPos.z,
			modelId: modelId,
			tempTokenId: tokenId
		};

		sendMessage('update', 'addToken', args);
	}

	//add token to map object
	map.scene.add(token);

	map.objects.tokens[tokenId] = token;
	map.translateControls.token.translateObjects.push(token);
	
	makeTokenInstance(token, map.models[modelId]);

	//add icons for owned tokens
	if (!token.settings.hideAvatar) {
		if (isDM || owners.indexOf(user_id) > -1) {
			addAvatar(token);
		}
		else {
			addAvatar(token, false);
		}
	}
}

function makeTokenInstance(parent, model) {
	var size = model.size;
	var textureSize = map.settings.maxTokenTextureSize * size * parent.scale.y;
	var src = model.src ? options.imageUrl({ kind: 'model', src: model.src, size: textureSize, quality: map.settings.maxTokenTextureQuality }) : null;

	//base
	var baseOffset = 0.41;
	var baseSize = (size / 2) - 0.1;
	var baseThickness = 0.05;
	var cGeometry = new THREE.CylinderGeometry( baseSize, baseSize, baseThickness, 32 );
	var cMaterial = new THREE.MeshPhongMaterial( { color: model.baseColor } );
	var previousBase = parent.base;
	var base = new THREE.Mesh( cGeometry, cMaterial );		
	base.position.set(0, -0.5 + baseThickness, 0);
	base.dmSelectable = parent;
	base.name = 'base';
	base.token = parent;
	parent.hoverTarget = base;
	parent.base = base;
	// NOTE(port): forget the previous base when the model is replaced, or hover keeps raycasting it.
	var oldBase = map.hover.targets.indexOf(previousBase);
	if (oldBase > -1) { map.hover.targets.splice(oldBase, 1); }
	map.hover.targets.push(base);

	//placeholder
	var placeHolderGeometry = new THREE.BoxGeometry( size, size, size );
	var placeHolderMaterial = new THREE.MeshBasicMaterial({ color: 0x00ff00, side: THREE.DoubleSide });
	var placeHolder = new THREE.Mesh(placeHolderGeometry, placeHolderMaterial);
	placeHolder.size = size;
	placeHolder.name = 'placeHolder';
	placeHolder.visible = false;
	placeHolder.token = parent;
	parent.placeHolder = placeHolder;
	
	//remove any old models
	for (var i=0;i<parent.children.length;i++) {
		if (parent.children[i].name == 'model') {
			for (var j=0;j<parent.children[i].children.length;j++) {
				var child = parent.children[i].children[j];
				
				if (child.material.map != null) {
					child.material.map.dispose();
				}
				
				child.material.dispose();
				child.geometry.dispose();
			}
				
			parent.remove(parent.children[i]);
			break;
		}
	}

	var modelGroup = new THREE.Group();
	modelGroup.baseOffset = baseOffset;
	modelGroup.baseThickness = baseThickness;
	modelGroup.name = 'model';
	modelGroup.placeHolder = placeHolder;
	modelGroup.add(base);
	modelGroup.add(placeHolder);

	parent.meshes = modelGroup;
	parent.add(modelGroup);
	
	if (parent.scale.y > 1) {
		modelGroup.position.y = model.modelOffset[1] * parent.scale.y;
	}

	// Finishes setting up a token once its visible body exists (textured plane or fallback).
	function tokenBodyReady() {
		tokenScaleReposition(parent);
		updateTokenPlaceHolder(parent);

		loadStateUpdate();

		updateVisionMeshes();
		updateTokenVision();
	}

	// NOTE(port): tokens without an image (a plain self-hosted server has no image library), or
	// whose image fails to load, are drawn as a coloured cylinder.
	function addFallbackBody() {
		var bodyHeight = size * 0.9;
		var bodyRadius = (size / 2) - 0.2;
		var geometry = new THREE.CylinderGeometry(bodyRadius * 0.85, bodyRadius, bodyHeight, 24);
		var material = new THREE.MeshPhongMaterial({ color: model.baseColor });
		var body = new THREE.Mesh(geometry, material);
		body.position.set(0, (bodyHeight / 2) - baseOffset, 0);

		modelGroup.geoWidth = bodyRadius * 2;
		modelGroup.geoHeight = bodyHeight;
		modelGroup.add(body);

		tokenBodyReady();
	}

	if (src === null) {
		addFallbackBody();
		return;
	}

	const texture = new THREE.TextureLoader().load(src, function(tex) {
		
		if (tex.image.height >= tex.image.width) {
			var geoWidth = size * model.scale;
			var geoHeight = size * model.scale * (tex.image.height/tex.image.width);
		}
		else {
			var geoWidth = size * model.scale * (tex.image.width/tex.image.height);
			var geoHeight = size * model.scale;
		}
		
		texture.repeat.set(model.textureRepeat[0], model.textureRepeat[1]);
		texture.offset.set(model.textureOffset[0], model.textureOffset[1]);

		var geometry = new THREE.PlaneGeometry(geoWidth, geoHeight);
		
		const material = new THREE.MeshPhongMaterial({
			color: 0xffffff,
			map: texture,
			alphaTest: 0.2,
			side: THREE.DoubleSide
		});	

		const mesh = new THREE.Mesh(geometry, material);

		mesh.position.set(model.modelOffset[0], (geoHeight / 2) - baseOffset + model.modelOffset[1], 0);

		modelGroup.geoWidth = geoWidth;
		modelGroup.geoHeight = geoHeight;
		modelGroup.add(mesh);

		tokenBodyReady();

	}, undefined, function(error) {
		console.warn('token image failed to load', error);
		addFallbackBody();
	});
}

function updateTokenTextureSize(maxSize) {
	map.settings.maxTokenTextureSize = maxSize;
	
	for (var i=0;i<map.objects.tokens.length;i++) {
		var parent = map.objects.tokens[i];
		var model = map.models[map.objects.tokens[i].modelId];
		var basic = user_id in map.objects.tokens[i].owners;
		
		makeTokenInstance(parent, model, basic);
	}

	for (const [tokenId, token] of Object.entries(map.objects.tokens)) {
		var parent = token;
		var model = map.models[token.modelId];
		var basic = user_id in token.owners;
		
		makeTokenInstance(parent, model, basic);
	}
}

function chooseTokenModel(modelId) {
	if (modelId in map.models) {		//add new token
		if (map.menuTarget == null) {
			if (map.lastClickPos != null) {
				var position = {
					x: parseInt(map.lastClickPos[0].point.x + 0.5),
					y: 0,
					z: parseInt(map.lastClickPos[0].point.z + 0.5)
				};

				createToken(position, new THREE.Vector3(1, 1, 1), modelId);
			}
		}
		else { 		//update existing token
			makeTokenInstance(map.menuTarget, map.models[modelId]);
			map.menuTarget.modelId = modelId;

			if (map.menuTarget.tokenId in map.objects.tokens) {
				sendMessage('update', 'updateTokenModel', { tokenId: map.menuTarget.tokenId, modelId: modelId });
			}
		}
	}
}

function openTokenSettings(e) {
	const token = map.menuTarget;

	// each radio group shows its own setting (the original set every group to the last setting)
	for (const item of map.panes.token_settings.items) {
		if (!(item.name in token.settings)) { continue; }
		var value = token.settings[item.name] ? 1 : 0;
		if (item.input[value]) { item.input[value].checked = true; }
	}

	openPane(map.panes.token_settings);
}

function assignTokenMenu(e) {
	map.menus.assignToken = new ContextMenu( {
		'theme': 'default',
		'items': getUserDetailItems()
	});
	
	openContextMenu(e, map.menus.assignToken);
}

function assignToken(e) {
	hideContextMenu();
	var assigneeuser_id = getContextData(e);
	
	if (assigneeuser_id != null) {
		if (map.menuTarget.tokenId in map.objects.tokens) {
			// NOTE(port): the original replaced the owner list. In protocol v2 assignToken adds or
			// removes one owner, so first remove the previous owners to keep "assign = replace".
			var previousOwners = map.menuTarget.owners.filter((owner) => owner != assigneeuser_id);
			for (const previousOwner of previousOwners) {
				sendMessage('update', 'assignToken', { tokenId: map.menuTarget.tokenId, user_id: previousOwner, owned: false });
			}

			map.menuTarget.owners = [assigneeuser_id];

			var args = {
				tokenId: map.menuTarget.tokenId,
				user_id: assigneeuser_id,
				owned: true
			};

			sendMessage('update', 'assignToken', args);
		}
	}
}

function createPlaneImage(file, planeUploadId, position, local = true, scale = new THREE.Vector2(1, 1), rotation = 0, planeId = false) {
	var image = options.imageUrl({ kind: 'plane', src: file, size: map.settings.maxPlaneTextureSize, quality: map.settings.maxPlaneTextureQuality });
	
	var material = new THREE.MeshLambertMaterial({
		color: 0xffffff,
		side: THREE.FrontSide,
		transparent: true,
		dithering: true
	});
	var plane = new THREE.Mesh();
	plane.material = material;
	plane.name = 'plane';
	plane.toggleMode = 'plane';
	plane.dmSelectable = plane;
	plane.position.set(position.x, -0.52, position.y);

	plane.rotation.x = - Math.PI * 0.5;
	plane.rotation.z = rotation;
	
	plane.scale.x = scale.x;
	plane.scale.y = scale.y;

	var planeLength = Object.values(map.objects.planes).length;

	plane.renderOrder = planeLength;
	plane.position.y += (planeLength / 100);

	plane.src = file;

	plane.defaultMatrix = {
		position: new THREE.Vector3().copy(plane.position),
		scale: new THREE.Vector3().copy(plane.scale),
		rotation: new THREE.Euler().copy(plane.rotation)
	};

	map.hover.targets.push(plane);
	map.translateControls.plane.translateObjects.push(plane);
	map.scene.add(plane);

	if (!planeId) {
		planeId = newLocalId();
	}

	plane.planeId = planeId;

	map.objects.planes[planeId] = plane;
	
	if (local) {
		var args = {
			x: plane.position.x,
			z: plane.position.z,
			planeUploadId: planeUploadId,
			image: file,
			tempPlaneId: planeId
		};

		sendMessage('update', 'addPlane', args);
	}

	new THREE.TextureLoader().load(image, function(texture) {
		
		var maxPlaneSize = 5;

		if (texture.image.width > texture.image.height) {
			var texSize = {
				w: maxPlaneSize,
				h: (texture.image.height / texture.image.width) * maxPlaneSize
			};
		}
		else {
			var texSize = {
				w: (texture.image.width / texture.image.height) * maxPlaneSize,
				h: maxPlaneSize,
			};
		}

		var geometry = new THREE.PlaneGeometry(texSize.w, texSize.h, 1, 1);
		plane.geometry = geometry;
		
		texture.magFilter = THREE.LinearFilter;
		texture.minFilter = THREE.LinearFilter;

		plane.material.map = texture;
		plane.material.needsUpdate = true;

		loadStateUpdate();
		
	}, false, function(error) {
		console.log(error);
		loadStateUpdate();
	});
}

function initPing() {
	var circleRadius = 1;
	var shape = new THREE.Shape().absarc( 0, 0, circleRadius, 0, Math.PI * 2, false )
	var holePath = new THREE.Path().absarc( 0, 0, circleRadius - 0.1, 0, Math.PI * 2, true );
	shape.holes.push( holePath );
	var extrudeSettings = { depth: 0.1, bevelEnabled: false, steps: 2 };
	var geometry = new THREE.ExtrudeGeometry( shape, extrudeSettings );
	var animationGroup = new THREE.AnimationObjectGroup();
	
	var mesh = new THREE.Mesh( geometry, new THREE.MeshBasicMaterial( { color: 0x0886c4, transparent: true, opacity: 0 } ));
	mesh.position.set( -5, 0, -5 );
	mesh.rotation.x = Math.PI / 2;
	mesh.renderOrder = -1;
	map.scene.add(mesh);

	var distance = 3;
	var yPos = -0.5;

	var opacityKF = new THREE.NumberKeyframeTrack( '.material.opacity', [ 0, 1 ], [ 1, 1 ] );
	var scaleKF = new THREE.VectorKeyframeTrack( '.scale', [ 0, 1 ], [ 1, 1, 1, 2, 2, 2 ] );

	var playClip = function(e, color, position = false, local = true) {
		mesh.material.color.setHex(color);
		
		if (!position) {
			var mousePosition = parseClickPos(e);

			//raycaster
			var raycast = new THREE.Raycaster();
			raycast.setFromCamera(mousePosition, map.objects.camera);
			var intersects = raycast.intersectObjects([map.objects.plane], false);

			if (intersects.length > 0) {
				var position = { x: intersects[0].point.x, z: intersects[0].point.z };
			}
		}
		
		var positionKF = new THREE.VectorKeyframeTrack( '.position', [ 0, 1, 0 ], [
			position.x,
			yPos,
			position.z,

			position.x,
			yPos + distance,
			position.z,

			position.x,
			yPos - distance,
			position.z,
		]);
		
		var clip = new THREE.AnimationClip( 'Action', 1, [ positionKF, opacityKF, scaleKF ] );
		mixer = new THREE.AnimationMixer( mesh );
		mixer.loop = false;
		var clipAction = mixer.clipAction( clip );
		clipAction.loop = THREE.LoopOnce;
		clipAction.clampWhenFinished = true;
		clipAction.play();

		//send to clients
		if (local) {
			var args = {
				x: position.x,
				z: position.z,
				user_id: user_id
			};

			sendMessage('update', 'ping', args);
		}
	}
	
	return playClip;
}

// NOTE(port): in protocol v2 "assignHost" adds a host; the sender stays host too (the server does
// not demote anyone). The original handed the DM role over and demoted the sender locally; keeping
// the sender's host UI is what the server will actually allow, so we no longer demote.
function assignDM(e) {
	hideContextMenu();
	
	var assigneeuser_id = getContextData(e);
	
	if (assigneeuser_id != null && assigneeuser_id != user_id) {
		sendMessage('update', 'assignDM', { user_id: assigneeuser_id });
		notify('Host role given to ' + (map.users[assigneeuser_id] ? map.users[assigneeuser_id].name : 'that player') + '.');
	}
}

function updateGridSize(local = true) {
	map.objects.plane.geometry = new THREE.PlaneGeometry(map.settings.gridWidth, map.settings.gridHeight);
	map.objects.plane.position.set((map.settings.gridWidth / 2) - 0.5, -0.53, (map.settings.gridHeight / 2) - 0.5);
	
	if ('gridHelper' in map) {
		map.scene.remove(map.gridHelper);
	}

	var gridSize = map.settings.gridWidth >= map.settings.gridHeight ? map.settings.gridWidth : map.settings.gridHeight;
	var widthOffset = (map.settings.gridWidth % 2 == (map.settings.gridHeight % 2 == 0)) * 0.5;

	var offset = {
		x: gridSize == map.settings.gridWidth ? 0 : widthOffset,
		z: gridSize != map.settings.gridWidth ? 0 : widthOffset
	}

	map.gridHelper = createGrid(map.settings.gridWidth, map.settings.gridHeight, 1, 0x000000);
	map.gridHelper.rotation.x = Math.PI * 0.5;
	map.gridHelper.position.x -= 0.5;
	map.gridHelper.position.y = -0.51;
	map.gridHelper.position.z -= 0.5;
	map.scene.add(map.gridHelper);

	//update mask size
	if ('mask' in map) {
		map.mask.fog.setGrid(map.settings.gridWidth, map.settings.gridHeight);
	}

	if (local) {
		var args = {
			width: map.settings.gridWidth,
			height: map.settings.gridHeight
		}

		sendMessage('update', 'updateGridSize', args);
	}
}

// The server accepts grid sizes from 1 to 1000; the settings pane offers 2 to 1000.
var MAX_GRID_SIZE = 1000;
function clampGridSize(value) {
	var n = Math.round(Number(value));
	if (!Number.isFinite(n)) { return 100; }
	return Math.min(MAX_GRID_SIZE, Math.max(2, n));
}

function createGrid(width, height, squareSize, color) {
	width++;
	height++;

	var material = new THREE.LineBasicMaterial({
		color: color
	});

	var gridObject = new THREE.Object3D();
	var gridGeo = new THREE.BufferGeometry();

	var vertices = [];

	//horizontal lines
	for (var x=0;x<width;x+=squareSize) {
		for (var y=0;y<height;y+=squareSize) {
			vertices.push(x);
			vertices.push(y);
			vertices.push(0);
		}
		
		vertices.push(x);
		vertices.push(0);
		vertices.push(0);
	}

	//vertical lines
	for (var y=0;y<height;y+=squareSize) {
		for (var x=0;x<width;x+=squareSize) {
			vertices.push(x);
			vertices.push(y);
			vertices.push(0);
		}
		
		vertices.push(0);
		vertices.push(y);
		vertices.push(0);
	}

	var points = new Float32Array(vertices);

	gridGeo.setAttribute( 'position', new THREE.BufferAttribute( points, 3 ) );

	var line = new THREE.Line(gridGeo, material, THREE.LineSegments);
	gridObject.add(line);	

	return gridObject;
}

// A press counts as a click when it is released within CLICK_MS, and a second press within
// CLICK_MS of the first is a double-click (a ping). Both are measured with the events' own
// timestamps (when the input happened), not with a timer: on a slow machine a heavy frame can
// delay the handlers past a timer and a normal click was then thrown away.
var CLICK_MS = 200;
var lastPointerDown = -Infinity;
var contextTimer;
var clickValid = false;

function eventTime(event) {
	return typeof event.timeStamp === 'number' && event.timeStamp > 0 ? event.timeStamp : performance.now();
}
var sceneTouchDown = {
	x: 0,
	y: 0
};
var pointerCount = 0;

function canvasCheck(event) {
	event = event || window.event;	

	map.pointerWhich = event.which;

	pointerCount++;

	startWallDrag(event);

	sceneTouchDown.x = event.clientX;
	sceneTouchDown.y = event.clientY;

	//box select
	setTimeout(function() {
		if (map.selectModeActive) {
			map.selectionBox.startPoint.set(
					ndcX(sceneTouchDown.x),
					ndcY(sceneTouchDown.y),
					0.5
			);

			map.selectionBox.endPoint.set(
				ndcX(sceneTouchDown.x),
					ndcY(sceneTouchDown.y),
					0.5
			);

			clearTimeout(contextTimer);
			handleSelectionBox();
			return;
		}
	}, 0);

	var downAt = eventTime(event);
	var doubleClick = downAt - lastPointerDown < CLICK_MS;
	lastPointerDown = downAt;

	if (doubleClick && event.which == 1 && pointerCount < 2) { 	//double click
		if (user_id in map.users) {
			var color = map.users[user_id].color;
		}
		else {
			var color = 'a83232';
		}

		map.ping(event, '0x' + color);
	}
	
	clickValid = true;
	
	clearTimeout(contextTimer);

	(function () {
		var e = event;

		contextTimer = setTimeout(function() {
			if (e.pointerType == 'touch') {
				checkSceneClick(e, 'right');
			}
		},1000);
	}());
}

function canvasMove(event) {
	event = event || window.event;	

	trackBuildPointer(event);

	if (pointerCount > 1) {
		clearTimeout(contextTimer);
	}
	else {
		var touchMove = {
			x: event.clientX,
			y: event.clientY
		};

		map.pointer.x = ndcX(event.clientX);
		map.pointer.y = ndcY(event.clientY);		

		//box select
		if (map.selectModeActive && map.selectionHelper.isDown) {
			map.selectionBox.endPoint.set(
				ndcX(touchMove.x),
				ndcY(touchMove.y),
				0.5
			);

			handleSelectionBox();
			return;
		}

		var tollerance = 2;

		var checks = [
			(touchMove.x > sceneTouchDown.x + tollerance),
			(touchMove.x < sceneTouchDown.x - tollerance),
			(touchMove.y > sceneTouchDown.y + tollerance),
			(touchMove.y < sceneTouchDown.y - tollerance),
		];

		for (var i=0;i<checks.length;i++) {
			if (checks[i]) {
				clearTimeout(contextTimer);
				break;
			}
		}
	}
}

function canvasClick(event) {
	event = event || window.event;	
	
	pointerCount--;

	if (map.wallDrag) {
		endWallDrag(event);
		return;
	}

	//box select
	if (map.selectModeActive) {
		map.selectionBox.endPoint.set(
			ndcX(event.clientX),
			ndcY(event.clientY),
			0.5
		);

		map.sideButtons.selectMode.element.click(); 	//turn off select once done
		handleSelectionBox();
		return;
	}

	clearTimeout(contextTimer);
	// released too late: a long press or a drag, not a click
	if (!clickValid || eventTime(event) - lastPointerDown >= CLICK_MS) { return false; }
	
	if (event.which < 2) {
		checkSceneClick(event, 'left');
	}
	else if (event.which == 3) {
		checkSceneClick(event, 'right');
	}
}

function checkSceneClick(e, clickType) {
	//cancel non dm context menus
	if (!isDM && clickType == 'right') {
		return false;	
	}
	
	//user menu item
	if (clickType == 'right') {
		if (e.target.classList.contains('user-section-item')) {
			var userSectionId = null;
			hideContextMenu();

			if (e.target.classList.contains('user-container')) {
				userSectionId = e.target.id.split('user-')[1];
			}
			else if (e.target.parentNode.classList.contains('user-container')) {
				userSectionId = e.target.parentNode.id.split('user-')[1];
			}

			if (userSectionId != null) {
				map.menus.user = new ContextMenu( {
						'theme': 'default',
						'items': [
							{'icon': 'star', 'name': 'Make DM', data: userSectionId, action: (e) => assignDM(e)  },
						]
					});

				openContextMenu(e, map.menus.user);
				return;
			}
		}
	}
	
	//check token click
	if (map.toggleMode == 'token') {
		var tokenList = Object.values(map.objects.tokens);
		var tokenCheck = getClicked3DPoint(e, tokenList, true);	
		
		if (typeof(tokenCheck) != "undefined") {
			tokenLoop: for (var i=0;i<tokenCheck.length;i++) {
				var tokenParent = tokenCheck[i].object.parent;

				parentLoop: for (var j=0;j<3;j++) {
					if (tokenParent.name == 'token') {
						if (clickType == 'left') {
							tokenClick(tokenParent);
						}
						else if (clickType == 'right') {
							map.menuTarget = tokenParent;
							openContextMenu(e, map.menus.token);
						}
						
						return;
					}

					tokenParent = tokenParent.parent;
				}
			}
		}
	}
	
	//wall point click	
	if (map.toggleMode == 'wallPoint' && isDM) {
		var allPoints = [];

		for (const [wallPointGroupId, wallPointGroup] of Object.entries(map.wallPointGroups)) {
			for (const [wallPointId, wallPoint] of Object.entries(wallPointGroup.points)) {
				allPoints.push(wallPoint);
			}
		}

		var wallPointCheck = getClicked3DPoint(e, allPoints, true);

		if (typeof(wallPointCheck) != "undefined") {
			if (clickType == 'right') {
				map.menuTarget = wallPointCheck[0];
				openContextMenu(e, map.menus.wallPoint);
			}
			else if (map.wallTool == 'points') {
				clickWallPoint(wallPointCheck[0].object);
			}

			return;
		}
	}
	
	//wall mode click
	if (map.toggleMode == 'wallPoint' && isDM && map.wallTool == 'points') {
		if (clickType == 'left') {
			addWallPoint(e);
			return;
		}

		//right-click while drawing finishes the wall instead of opening the menu
		if (clickType == 'right' && lastActiveWallPoint()) {
			finishWall();
			return;
		}
	}

	//door click	
	if (isDM) {
		var doorList = Object.values(map.objects.doors);
		var doorCheck = getClicked3DPoint(e, doorList, true);			

		if (typeof(doorCheck) != "undefined") {
			doorLoop: for (var i=0;i<doorCheck.length;i++) {
				var doorParent = doorCheck[i].object.parent;

				parentLoop: for (var j=0;j<3;j++) {
					if (doorParent.name == 'door') {
						if (clickType == 'left') {
							doorClick(doorParent);
						}
						else if (clickType == 'right') {
							map.menuTarget = doorParent;
							openContextMenu(e, map.menus.door);
						}
						
						return;
					}

					doorParent = doorParent.parent;
				}
			}
		}
	}

	//door mode click
	if (map.toggleMode == 'door' && clickType == 'left') {
		addDoor(e);
	}

	//plane click
	if (isDM) {
		if (map.toggleMode == 'plane') {
			var planeCheck = getClicked3DPoint(e, Object.values(map.objects.planes), true);

			if (typeof(planeCheck) != "undefined") {
				for (var i=0;i<planeCheck.length;i++) {
					if (clickType == 'left') {
						planeClick(planeCheck[i].object);
						return;
					}
					else if (clickType == 'right') {
						setLastClickPos(e);
						map.menuTarget = planeCheck[i].object;
						openContextMenu(e, map.menus.defaultPlaneImage);
						return;
					}
				}
			}
		}
	}

	//default context menu
	if (clickType == 'right') {
		var planeCheck = getClicked3DPoint(e, [map.objects.plane], true);	
	
		if (typeof(planeCheck) != "undefined") {
			setLastClickPos(e);
			openContextMenu(e, map.menus.default);
		}
	}

	setTimeout(function() {
		clearGroupSelection();
	}, 0);
}

function setLastClickPos(e) {
	map.lastClickPos = getClicked3DPoint(e, [map.objects.plane], false);
}

function getContextData(e) {
	var data = null;
	
	if (e.target.classList.contains('context-menu-default-text')) {
		data = e.target.getAttribute('data');
	}
	else {
		var textElem = e.target.querySelector('.context-menu-default-text');

		if (textElem != null) {
			data = textElem.getAttribute('data');
		}
	}
	
	return data;
}

function tokenClick(token) {
	//found clicked token
	if (map.toggleMode == 'token' && (isDM || checkTokenOwner(token))) {
		map.outlinePass.selectedObjects = [token.base];
	}
}

function transformHasObject(transform) {
	return 'object' in transform && typeof(transform.object) != "undefined";
}

function clearGroupSelection() {
	//clear selection groups
	map.groupSelectObject = [];
	map.outlinePass.selectedObjects = [];

	for (const [name, translateControls] of Object.entries(map.translateControls)) {
		translateControls.translateGroupObjects = [];
	}
}

function handleSelectionBox() {
	var allSelected = map.selectionBox.select();
	var selectable = [];

	clearGroupSelection();

	for (var i=0;i<allSelected.length;i++) {
		if ('dmSelectable' in allSelected[i]) {
			var object = allSelected[i].dmSelectable;

			//objects to be transformed
			if ((isDM && object.toggleMode == map.toggleMode) || (map.toggleMode == 'token' && object.name == 'token' && (isDM || checkTokenOwner(object, 'handle')))) {
				if (object.toggleMode in map.translateControls) {
					selectable.push(allSelected[i]);
					map.translateControls[object.toggleMode].translateGroupObjects.push(object);
				}
			}
		}
	}

	map.outlinePass.selectedObjects = selectable;
}

var visionRaycaster = new THREE.Raycaster();
var debugArrows = false;

function updateTokenVision() {
	var token = map.local.tokenVisionActive;

	if (!map.loaded || token === false) { return false; }	

	render(); 		//make sure scene render is up to dote before checking vision

	var castCount = map.settings.maskPoints;
	var angleIncrement = (2*Math.PI) / castCount;

	var origin = new THREE.Vector3(token.position.x, 0, token.position.z);
	var intersects = [];	

	if (map.local.daylight) {
		var viewDistance = 100;
	}
	else {
		var viewDistance = map.models[token.modelId].viewDistance / 5;
	}

	visionRaycaster.near = 0;
	visionRaycaster.far = viewDistance;

	var firstPoint = false;

	var holePoints = [];

	if (!isDM || (isDM && map.local.dmLight === 0)) {
		for (const [tokenId, sToken] of Object.entries(map.objects.tokens)) {
			sToken.visible = (sToken == token);
		}
	}

	for (var i=0;i<castCount;i++) {
		var direction = new THREE.Vector3(1, 0, 1);
		direction.applyAxisAngle(new THREE.Vector3(0, 1, 0).normalize(), angleIncrement * i).normalize();

		visionRaycaster.set(origin, direction);

		var intersect = visionRaycaster.intersectObjects(map.visionMeshes, false);		

		var validIntersect = false;

		if (intersect.length > 0) {
			for (var j=0;j<intersect.length;j++) {
				if (intersect[j].distance < viewDistance) {
					if (intersect[j].object.name == 'placeHolder') {
						intersect[j].object.token.visible = true;
						continue;
					}
					
					if (debugArrows) {
						map.arrows[i].setLength(intersect[j].distance, 0, 0);
					}

					var intersectPos = new THREE.Vector3(intersect[j].point.x, 0, intersect[j].point.z);
					var displacement = new THREE.Vector3().copy(direction).multiplyScalar(0.1);
					var targetPoint = new THREE.Vector3().copy(intersectPos).add(displacement);
					var edgeBuffer = 0;

					targetPoint.x = targetPoint.x > map.settings.gridWidth - edgeBuffer ? map.settings.gridWidth - edgeBuffer : targetPoint.x;
					targetPoint.z = targetPoint.z > map.settings.gridHeight - edgeBuffer ? map.settings.gridHeight - edgeBuffer : targetPoint.z;
					targetPoint.x = targetPoint.x < edgeBuffer ? edgeBuffer : targetPoint.x;
					targetPoint.z = targetPoint.z < edgeBuffer ? edgeBuffer : targetPoint.z;

					if (!firstPoint) {
						firstPoint = true;

						holePoints.push({ x: targetPoint.x, z: targetPoint.z });
					}
					else {
						holePoints.push({ x: targetPoint.x, z: targetPoint.z });
					}

					validIntersect = true;
					break;
				}
			}
		}		
		
		if (!validIntersect) {
			if (debugArrows) {
				map.arrows[i].setLength(viewDistance, 0, 0);
			}

			var displacement = new THREE.Vector3().copy(direction).multiplyScalar(viewDistance);
			var targetPoint = new THREE.Vector3().copy(origin).add(displacement);
			var edgeOffset = 0.5;
			var edgeBuffer = 0.01;

			targetPoint.x = targetPoint.x > map.settings.gridWidth - edgeOffset - edgeBuffer ? map.settings.gridWidth - edgeOffset - edgeBuffer : targetPoint.x;
			targetPoint.z = targetPoint.z > map.settings.gridHeight - edgeOffset - edgeBuffer ? map.settings.gridHeight - edgeOffset - edgeBuffer : targetPoint.z;
			targetPoint.x = targetPoint.x < -edgeOffset + edgeBuffer ? -edgeOffset + edgeBuffer : targetPoint.x;
			targetPoint.z = targetPoint.z < -edgeOffset + edgeBuffer ? -edgeOffset + edgeBuffer : targetPoint.z;

			if (!firstPoint) {
				firstPoint = true;
				holePoints.push({ x: targetPoint.x, z: targetPoint.z });
			}
			else {
				holePoints.push({ x: targetPoint.x, z: targetPoint.z });
			}
		}

		if (debugArrows) {
			map.arrows[i].position.copy(origin);
			map.arrows[i].setDirection(direction);
			map.arrows[i].visible = true;
		}
	}

	map.mask.fog.setVision(holePoints);
}

function findParentToken(obj, depth = 3) {
	for (var j=0;j<depth;j++) {
		if (obj.name == 'token') {
			return obj;
		}

		obj = obj.parent;
	}

	return null;
}

// A player sees the table through one of their own tokens. Without one chosen (a new player, or
// the chosen token was removed or taken away) they would see nothing at all, even a token that was
// just handed to them, so the viewer picks one of theirs. Returns true when the choice changed.
function chooseOwnVisionToken() {
	if (isDM) { return false; }

	var active = map.local.tokenVisionActive;
	if (active && map.objects.tokens[active.tokenId] === active && checkTokenOwner(active)) { return false; }

	var next = false;
	for (const token of Object.values(map.objects.tokens)) {
		if (checkTokenOwner(token)) { next = token; break; }
	}

	if (next === active) { return false; }
	map.local.tokenVisionActive = next;

	if (next === false) {
		// nothing to see through: hide every token until one is assigned again
		for (const token of Object.values(map.objects.tokens)) { token.visible = false; }
	}

	return true;
}

function checkTokenOwner(token, callback = null) {
	for (var i=0;i<token.owners.length;i++) {
		if (token.owners[i] == user_id) {
			return true;
		}
	}
	
	return false;
}

function doorClick(door, local = true) {
	if (door != null) {
		if (map.toggleMode == 'door') {
			map.rotationControls.door.attach(door);
		}
		else {
			//toggle door
			var duration = 250; //ms
			var frames = (duration / 1000) * 60;
			var rotFr = DOOR_SWING / frames;
			var opening = !door.open;

			updateVisionMeshes();

			for (var i=0;i<frames;i++) {
				setTimeout(function() {
					swingDoorPanel(door, opening ? -rotFr : rotFr);

					if (map.settings.lightingQuality > 1) {
						updateTokenVision();
					}
				}, i * (duration / frames)); 		//600 ms  .6s
			}

			//update vision after animation
			if (map.settings.lightingQuality <= 1) {
				setTimeout(function() {
					updateTokenVision();
				}, duration + 1);
			}

			door.open = !door.open;

			//send door open change to server
			if (local) {
				var args = {
					doorId: door.doorId,
					open: door.open
				};
				
				sendMessage('update', 'updateDoorState', args);
			}
		}
	}
}

function planeClick(plane) {
	if (!isDM) { return false; }
	
	if (plane != null) {
		map.rotationControls.plane.attach(plane);
		map.scaleControls.plane.attach(plane);
	}
}

function addDoor(e, doorId = false, position = false, rotation = 0, open = 0, local = true) {
	if (!doorId) {
		doorId = newLocalId();
	}

	if (position === false) {
		var planeCheck = getClicked3DPoint(e, [map.objects.plane], false);
		
		if (typeof(planeCheck) != "undefined") {
			position = planeCheck[0].point;
		}

		//a click off the board (the sky) places nothing
		if (!position) { return false; }

		//dropped next to a wall: put it in the wall, lined up with it
		var snap = walls.snapDoorToWalls(position.x, position.z, allWallSegments(), DOOR_SIZE.width, rotation);

		if (snap) {
			position = new THREE.Vector3(snap.x, 0, snap.z);
			rotation = snap.rotation;
		}
		else {
			position.x = Math.round(position.x * 2) / 2;
			position.z = Math.round(position.z * 2) / 2;
		}
	}

	var parts = getDoorParts();

	var door = new THREE.Group();
	door.name = 'door';
	door.toggleMode = 'door';
	door.doorId = doorId;
	door.rotation.y = rotation;
	door.size = DOOR_SIZE;
	door.defaultYPos = (door.size.height/2) - 0.5;
	door.position.set(position.x, door.defaultYPos, position.z);
	door.prevPos = door.position.clone();

	var frame = new THREE.Mesh(parts.frameGeometry, parts.frameMaterial);
	frame.name = 'frame';
	frame.hoverTarget = door;
	frame.dmSelectable = door;

	var panel = new THREE.Mesh(parts.panelGeometry, parts.panelMaterial);
	panel.name = 'panel';
	panel.hoverTarget = door;
	panel.dmSelectable = door;

	//child of the panel so it swings with it; not a vision blocker (too small to matter)
	var handle = new THREE.Mesh(parts.handleGeometry, parts.handleMaterial);
	handle.name = 'handle';
	handle.hoverTarget = door;
	handle.dmSelectable = door;
	panel.add(handle);

	door.frame = frame;
	door.panel = panel;
	door.open = false;
	door.add(frame);
	door.add(panel);
	map.hover.targets.push(frame);
	map.hover.targets.push(panel);
	map.translateControls.door.translateObjects.push(door);

	map.objects.doors[doorId] = door;
	map.scene.add(door);

	if (open) {
		swingDoorPanel(door, -DOOR_SWING);
		door.open = true;
	}

	rebuildWalls();
	updateVisionMeshes();
	updateTokenVision();

	//send to server
	if (local) {
		var args = {
			tempDoorId: doorId,
			x: position.x,
			z: position.z
		}

		sendMessage('update', 'addDoor', args);

		//the server adds doors unrotated
		if (rotation !== 0) {
			sendDoorTransform(door);
		}

		pushUndo({ kind: 'addDoor', door: door });
	}
}

// How far an open door swings (radians).
var DOOR_SWING = Math.PI * 0.7;

// Turns the panel about its hinge side.
function swingDoorPanel(door, angle) {
	var hingeOffset = (door.size.width - (door.size.frameThickness * 1.5)) / 2;
	door.panel.translateX(hingeOffset);
	door.panel.rotation.y += angle;
	door.panel.translateX(-hingeOffset);
}

function sendDoorTransform(door) {
	sendMessage('update', 'updateDoorTransform', {
		doorId: door.doorId,
		x: door.position.x,
		z: door.position.z,
		rotation: door.rotation.y
	});
}

function addWallPoint(e, wallPointId = false, wallPointGroupId = map.wallPointGroupActive, position = false, local = true) {
	if (position === false) {
		var planeCheck = getClicked3DPoint(e, [map.objects.plane], false);
		
		if (typeof(planeCheck) != "undefined") {
			position = planeCheck[0].point;
		}
	}

	if (!position) { return false; }

	var wallPoint = createWallPoint(wallPointId, wallPointGroupId, position);
	finishWallChange(local ? [wallPoint] : []);
	return wallPoint;
}

// Adds several points to one wall with a single rebuild (rooms and corridors), and one undo step.
function addWallPoints(wallPointGroupId, positions) {
	var created = [];

	for (const position of positions) {
		created.push(createWallPoint(false, wallPointGroupId, new THREE.Vector3(position.x, 0, position.z)));
	}

	finishWallChange(created);
}

// Rebuilds the walls after points were added and tells the server about the local ones.
function finishWallChange(localPoints) {
	rebuildWalls(true);
	updateVisionMeshes();
	updateTokenVision();

	if (localPoints.length > 0) {
		for (const wallPoint of localPoints) {
			sendMessage('update', 'addWallPoint', {
				tempWallPointId: wallPoint.wallPointId,
				wallPointGroupId: wallPoint.wallPointGroupId,
				x: wallPoint.position.x,
				z: wallPoint.position.z
			});
		}

		pushUndo({ kind: 'addPoints', points: localPoints });
	}
}

var wallPointGeometry = null;
var wallPointMaterial = null;

// The round handle of one wall point (only visible to the host in wall mode).
function createWallPoint(wallPointId, wallPointGroupId, position) {
	if (!(wallPointGroupId in map.wallPointGroups)) {
		//a point from the server must not take over the wall the host is drawing
		var active = map.wallPointGroupActive;
		addWallGroup(wallPointGroupId);
		if (active) { map.wallPointGroupActive = active; }
	}	
	
	position.x = Math.round(position.x * 2) / 2;
	position.z = Math.round(position.z * 2) / 2;
	
	if (!wallPointId) {
		wallPointId = newLocalId();
	}

	var height = 0.05;

	if (!wallPointGeometry) {
		wallPointGeometry = new THREE.CylinderGeometry( 0.4, 0.4, height, 16 );
		wallPointGeometry.userData.shared = true;
		wallPointMaterial = new THREE.MeshLambertMaterial( { color: 0x49504e } );
		wallPointMaterial.userData.shared = true;
	}

	var wallPoint = new THREE.Mesh( wallPointGeometry, wallPointMaterial );
	wallPoint.name = 'wallPoint';
	wallPoint.toggleMode = 'wallPoint';
	wallPoint.dmSelectable = wallPoint;
	wallPoint.defaultYPos = (height/2) - 0.5;
	wallPoint.position.set(position.x, wallPoint.defaultYPos, position.z);
	wallPoint.prevPos = wallPoint.position.clone();
	wallPoint.wallPointId = wallPointId;
	wallPoint.wallPointGroupId = wallPointGroupId;
	wallPoint.visible = isDM && map.toggleMode == 'wallPoint';
	map.translateControls.wallPoint.translateObjects.push(wallPoint);
	map.hover.targets.push(wallPoint);

	map.wallPointGroups[wallPointGroupId].points[wallPointId] = wallPoint;
	map.scene.add(wallPoint);

	return wallPoint;
}

function addWallGroup(wallPointGroupId = false) {
	if (wallPointGroupId === false) {
		wallPointGroupId = newLocalId();
	}

	map.wallPointGroups[wallPointGroupId] = {
		wallPointGroupId: wallPointGroupId,
		mesh: false,
		points: {}
	};

	map.wallPointGroupActive = wallPointGroupId;
}

// One wall material for the whole map (a wall texture is then loaded once, not once per wall).
var wallMaterial = null;

function sharedWallMaterial() {
	if (!wallMaterial) {
		wallMaterial = createWallMaterial(options);
		wallMaterial.userData.shared = true;
	}

	return wallMaterial;
}

function wallGroupPoints(wallGroup) {
	var points = [];

	for (const point of Object.values(wallGroup.points)) {
		points.push({ x: point.position.x, z: point.position.z });
	}

	return points;
}

function doorSpans() {
	var spans = [];

	for (const door of Object.values(map.objects.doors)) {
		spans.push({ x: door.position.x, z: door.position.z, rotation: door.rotation.y, width: door.size.width });
	}

	return spans;
}

// Positions where two or more wall points meet; wall ends there are stretched to fill the corner.
function wallJoints() {
	var seen = new Set();
	var joints = new Set();

	for (const wallGroup of Object.values(map.wallPointGroups)) {
		for (const point of Object.values(wallGroup.points)) {
			var key = walls.pointKey({ x: point.position.x, z: point.position.z });

			if (seen.has(key)) { joints.add(key); }
			seen.add(key);
		}
	}

	return joints;
}

function allWallSegments() {
	var segments = [];

	for (const wallGroup of Object.values(map.wallPointGroups)) {
		segments.push(...walls.wallSegments(wallGroupPoints(wallGroup)));
	}

	return segments;
}

// Rebuilds wall geometry. Without `force` only groups whose door openings changed are rebuilt,
// which keeps dragging a door along a wall cheap on big maps.
function rebuildWalls(force = false) {
	if (map.deferWalls) { return; }

	var doors = doorSpans();
	var joints = force ? wallJoints() : null;

	for (const wallGroup of Object.values(map.wallPointGroups)) {
		if (force) {
			updateWallGroup(wallGroup, doors, joints);
		}
		else if (walls.doorCutKey(wallGroupPoints(wallGroup), doors) !== wallGroup.cutKey) {
			updateWallGroup(wallGroup, doors, joints || (joints = wallJoints()));
		}
	}
}

function updateWallGroup(wallGroup, doors = null, joints = null) {
	if (map.deferWalls) { return; }

	var pointLength = Object.keys(wallGroup.points).length;

	if (pointLength > 0) {
		var points = wallGroupPoints(wallGroup);
		doors = doors || doorSpans();

		var arrays = walls.buildWallArrays(points, doors, joints || wallJoints());
		var geometry = new THREE.BufferGeometry();
		geometry.setAttribute('position', new THREE.BufferAttribute(arrays.positions, 3));
		geometry.setAttribute('normal', new THREE.BufferAttribute(arrays.normals, 3));
		geometry.setIndex(new THREE.BufferAttribute(arrays.indices, 1));
		wallGroup.cutKey = walls.doorCutKey(points, doors);

		if (options.wallTexture) {
			geometry = addWallUvs(geometry, wallTileSize(options));
		}

		if (!wallGroup.mesh) {
			var mesh = new THREE.Mesh(geometry, sharedWallMaterial());
			mesh.name = 'wall mesh';
			wallGroup.mesh = mesh;
			map.scene.add(mesh);
		}
		else {
			wallGroup.mesh.geometry.dispose();
			wallGroup.mesh.geometry = geometry;
		}
	}
	else {
		//remove wall group
		if (wallGroup.mesh) {
			map.scene.remove(wallGroup.mesh);
			wallGroup.mesh.geometry.dispose();
		}
		delete map.wallPointGroups[wallGroup.wallPointGroupId];
	}
}

function removeDoor(doorId = false, local = true) {
	hideContextMenu();

	if (doorId === false) {
		var door = map.menuTarget;
		doorId = door.doorId;
	}

	if (doorId in map.objects.doors) {
		var removed = map.objects.doors[doorId];
		map.scene.remove(removed);
		map.rotationControls.door.detach();
		delete map.objects.doors[doorId];
		removeFromList(map.translateControls.door.translateObjects, removed);
		removeFromList(map.hover.targets, removed.frame);
		removeFromList(map.hover.targets, removed.panel);

		if (local) {
			pushUndo({ kind: 'removeDoor', x: removed.position.x, z: removed.position.z, rotation: removed.rotation.y });
		}
		
		rebuildWalls();
		updateVisionMeshes();
		updateTokenVision();
	}

	//send to server
	if (local) {
		var args = {
			doorId: doorId
		};
		
		sendMessage('update', 'removeDoor', args);
	}
}

function removeFromList(list, item) {
	var index = list.indexOf(item);
	if (index !== -1) { list.splice(index, 1); }
}

function removeWallPoint(wallPointGroupId = false, wallPointId = false, local = true) {
	hideContextMenu();

	if (wallPointGroupId === false && wallPointId === false) {
		var wallPoint = map.menuTarget.object;
		wallPointGroupId = wallPoint.wallPointGroupId;
		wallPointId = wallPoint.wallPointId;
	}
	
	if (wallPointGroupId in map.wallPointGroups && wallPointId in map.wallPointGroups[wallPointGroupId].points) {
		var removed = map.wallPointGroups[wallPointGroupId].points[wallPointId];
		map.scene.remove(removed);
		delete map.wallPointGroups[wallPointGroupId].points[wallPointId];
		removeFromList(map.translateControls.wallPoint.translateObjects, removed);
		removeFromList(map.hover.targets, removed);
		
		rebuildWalls(true);
		updateVisionMeshes();
		updateTokenVision();

		if (local) {
			var args = {
				wallPointGroupId: wallPointGroupId,
				wallPointId: wallPointId
			};
			
			sendMessage('update', 'removeWallPoint', args);
		}
	}
}

// ---- map building: undo, joining walls, room / corridor tools, previews ----

var CORRIDOR_WIDTH = 2;		//squares
var undoStack = [];
var undoing = false;		//undo itself must not add undo steps

function pushUndo(entry) {
	if (undoing) { return; }

	undoStack.push(entry);

	if (undoStack.length > 50) { undoStack.shift(); }
}

function doorTransforms(doors) {
	return doors.filter(Boolean).map(function(door) {
		return { door: door, x: door.position.x, z: door.position.z, rotation: door.rotation.y };
	});
}

function wallPointPositions(points) {
	return points.map(function(point) {
		return { point: point, x: point.position.x, z: point.position.z };
	});
}

// Records a drag or turn as one undo step, if anything actually moved.
function pushTransformUndo(items) {
	if (!items) { return; }

	var changed = items.filter(function(item) {
		var object = item.door || item.point;
		return object.position.x !== item.x || object.position.z !== item.z || (item.door && object.rotation.y !== item.rotation);
	});

	if (changed.length > 0) {
		pushUndo({ kind: 'transform', items: changed });
	}
}

function undo() {
	var entry = undoStack.pop();

	if (!entry) {
		notify('Nothing to undo');
		return;
	}

	undoing = true;

	try {
		if (entry.kind == 'addPoints') {
			for (const point of entry.points.slice().reverse()) {
				removeWallPoint(point.wallPointGroupId, point.wallPointId);
			}
		}
		else if (entry.kind == 'addDoor') {
			if (map.objects.doors[entry.door.doorId] === entry.door) {
				removeDoor(entry.door.doorId);
			}
		}
		else if (entry.kind == 'removeDoor') {
			addDoor(false, false, new THREE.Vector3(entry.x, 0, entry.z), entry.rotation);
		}
		else if (entry.kind == 'transform') {
			map.rotationControls.door.detach();

			for (const item of entry.items) {
				if (item.door) {
					if (map.objects.doors[item.door.doorId] !== item.door) { continue; }

					item.door.position.x = item.x;
					item.door.position.z = item.z;
					item.door.rotation.y = item.rotation;
					item.door.prevPos = item.door.position.clone();
					sendDoorTransform(item.door);
				}
				else {
					var group = map.wallPointGroups[item.point.wallPointGroupId];
					if (!group || group.points[item.point.wallPointId] !== item.point) { continue; }

					item.point.position.x = item.x;
					item.point.position.z = item.z;
					item.point.prevPos = item.point.position.clone();
					sendMessage('update', 'updateWallPoint', {
						wallPointGroupId: item.point.wallPointGroupId,
						wallPointId: item.point.wallPointId,
						x: item.x,
						z: item.z
					});
				}
			}

			rebuildWalls(true);
			updateVisionMeshes();
			updateTokenVision();
		}
	}
	finally {
		undoing = false;
	}

	scheduleGhosts();
}

// Points of other walls sitting on the dragged point move with it, so joined walls stay joined.
function addJoinedWallPoints(controls) {
	var dragged = controls.translateGroupObjects;
	var extra = [];

	for (const point of dragged) {
		for (const wallGroup of Object.values(map.wallPointGroups)) {
			for (const other of Object.values(wallGroup.points)) {
				if (other === point || dragged.includes(other) || extra.includes(other)) { continue; }

				if (other.position.x === point.position.x && other.position.z === point.position.z) {
					other.translateControls = {
						offsetPos: point.translateControls.offsetPos.clone(),
						originalPos: other.position.clone()
					};
					extra.push(other);
				}
			}
		}
	}

	dragged.push(...extra);
}

function allWallPoints() {
	var points = [];

	for (const wallGroup of Object.values(map.wallPointGroups)) {
		points.push(...Object.values(wallGroup.points));
	}

	return points;
}

function lastActiveWallPoint() {
	var group = map.wallPointGroups[map.wallPointGroupActive];
	if (!group) { return null; }

	var points = Object.values(group.points);
	return points.length > 0 ? points[points.length - 1] : null;
}

// Ends the wall being drawn; the next click starts a new one.
function finishWall() {
	if (lastActiveWallPoint()) {
		addWallGroup();
	}

	scheduleGhosts();
}

// Clicking an existing point: on the end of the wall being drawn it finishes the wall, anywhere
// else it adds a point exactly there (closing a room or joining another wall) and finishes.
// With nothing drawn yet it starts a new wall from that point.
function clickWallPoint(hit) {
	var last = lastActiveWallPoint();

	if (last && last.position.x === hit.position.x && last.position.z === hit.position.z) {
		finishWall();
		return;
	}

	addWallPoint(false, false, map.wallPointGroupActive, new THREE.Vector3(hit.position.x, 0, hit.position.z));

	if (last) {
		finishWall();
	}
}

// Adds whole walls (rooms, corridors) in one go: one rebuild and one undo step.
function addWallPolylines(polylines) {
	var created = [];

	for (const polyline of polylines) {
		var wallPointGroupId = newLocalId();

		for (const position of polyline) {
			created.push(createWallPoint(false, wallPointGroupId, new THREE.Vector3(position.x, 0, position.z)));
		}
	}

	finishWallChange(created);
}

function dragOutlines(drag) {
	if (map.wallTool == 'room') {
		var outline = walls.roomOutline(drag.start, drag.end);
		return outline ? [outline] : [];
	}

	var corridor = walls.corridorWalls(drag.start, drag.end, CORRIDOR_WIDTH);
	return corridor ? corridor : [];
}

var buildRaycaster = new THREE.Raycaster();
var buildPointer = new THREE.Vector2();

function groundPoint(clientX, clientY) {
	buildPointer.set(ndcX(clientX), ndcY(clientY));
	buildRaycaster.setFromCamera(buildPointer, map.objects.camera);

	var hit = buildRaycaster.intersectObject(map.objects.plane, false);
	return hit.length > 0 ? hit[0].point : null;
}

function isBuildMode() {
	return isDM && (map.toggleMode == 'wallPoint' || map.toggleMode == 'door');
}

// Room / corridor tools: a left drag on the ground draws instead of panning.
function startWallDrag(event) {
	if (!isDM || map.toggleMode != 'wallPoint' || map.wallTool == 'points' || event.button !== 0 || pointerCount > 1) { return; }
	if (getClicked3DPoint(event, allWallPoints(), false)) { return; }	//dragging a point instead

	var p = groundPoint(event.clientX, event.clientY);

	if (p) {
		map.wallDrag = { start: { x: p.x, z: p.z }, end: { x: p.x, z: p.z } };
		scheduleGhosts();
	}
}

function endWallDrag(event) {
	var drag = map.wallDrag;
	map.wallDrag = null;

	var p = groundPoint(event.clientX, event.clientY);
	if (p) { drag.end = { x: p.x, z: p.z }; }

	var outlines = dragOutlines(drag);

	if (outlines.length > 0) {
		addWallPolylines(outlines);
	}

	scheduleGhosts();
}

function buildGhosts() {
	if (map.ghost) { return map.ghost; }

	var parts = getDoorParts();
	var ghost = {};

	var segmentGeometry = new THREE.BoxGeometry(1, walls.WALL_HEIGHT, walls.WALL_THICKNESS);
	segmentGeometry.translate(0, walls.FLOOR_Y + (walls.WALL_HEIGHT / 2), 0);
	ghost.segment = new THREE.Mesh(segmentGeometry, parts.ghostMaterial);

	ghost.marker = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.06, 16), parts.ghostMaterial);
	ghost.marker.position.y = walls.FLOOR_Y + 0.03;

	ghost.walls = new THREE.Mesh(new THREE.BufferGeometry(), parts.ghostMaterial);
	ghost.wallsKey = '';

	ghost.door = new THREE.Group();
	ghost.door.add(new THREE.Mesh(parts.frameGeometry, parts.ghostMaterial));
	ghost.door.add(new THREE.Mesh(parts.panelGeometry, parts.ghostMaterial));
	ghost.door.position.y = (DOOR_SIZE.height / 2) - 0.5;

	for (const object of [ghost.segment, ghost.marker, ghost.walls, ghost.door]) {
		object.visible = false;
		object.renderOrder = 10;
		map.scene.add(object);
	}

	map.ghost = ghost;
	return ghost;
}

// One merged geometry for several wall outlines (the preview of a corridor is two walls).
function wallPreviewGeometry(outlines) {
	var list = outlines.map(function(outline) { return walls.buildWallArrays(outline, [], new Set()); });
	var vertexCount = 0, indexCount = 0;

	for (const arrays of list) {
		vertexCount += arrays.positions.length;
		indexCount += arrays.indices.length;
	}

	var positions = new Float32Array(vertexCount);
	var normals = new Float32Array(vertexCount);
	var indices = new Uint32Array(indexCount);
	var v = 0, i = 0;

	for (const arrays of list) {
		positions.set(arrays.positions, v);
		normals.set(arrays.normals, v);

		for (var j = 0; j < arrays.indices.length; j++) {
			indices[i + j] = arrays.indices[j] + (v / 3);
		}

		v += arrays.positions.length;
		i += arrays.indices.length;
	}

	var geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
	geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
	geometry.setIndex(new THREE.BufferAttribute(indices, 1));
	return geometry;
}

var ghostPointer = null;
var ghostFrame = 0;

function trackBuildPointer(event) {
	if (!isBuildMode()) { return; }

	ghostPointer = { x: event.clientX, y: event.clientY };
	scheduleGhosts();
}

// Previews are updated at most once per frame, however fast the pointer moves.
function scheduleGhosts() {
	if (!ghostFrame && map.ghost) {
		ghostFrame = requestAnimationFrame(updateGhosts);
	}
}

function updateGhosts() {
	ghostFrame = 0;
	var ghost = map.ghost;

	if (destroyed || !ghost) { return; }

	ghost.segment.visible = false;
	ghost.marker.visible = false;
	ghost.walls.visible = false;
	ghost.door.visible = false;

	if (!isBuildMode() || ghostPointer === null) { return; }

	var p = groundPoint(ghostPointer.x, ghostPointer.y);
	if (!p) { return; }

	if (map.toggleMode == 'wallPoint') {
		if (map.wallDrag) {
			map.wallDrag.end = { x: p.x, z: p.z };
			var outlines = dragOutlines(map.wallDrag);
			var key = JSON.stringify(outlines);

			//rebuilt only when the snapped outline changes, not on every pointer move
			if (key !== ghost.wallsKey) {
				ghost.wallsKey = key;
				ghost.walls.geometry.dispose();
				ghost.walls.geometry = wallPreviewGeometry(outlines);
			}

			ghost.walls.visible = outlines.length > 0;
		}
		else if (map.wallTool == 'points') {
			var hits = getClicked3DPointAt(ghostPointer, allWallPoints());
			var target = hits ? hits[0].object.position : { x: walls.snapHalf(p.x), z: walls.snapHalf(p.z) };
			ghost.marker.position.x = target.x;
			ghost.marker.position.z = target.z;
			ghost.marker.visible = true;

			var last = lastActiveWallPoint();

			if (last) {
				var dx = target.x - last.position.x;
				var dz = target.z - last.position.z;
				var length = Math.hypot(dx, dz);

				if (length > 0) {
					ghost.segment.position.set((last.position.x + target.x) / 2, 0, (last.position.z + target.z) / 2);
					ghost.segment.rotation.y = walls.rotationAlong(dx / length, dz / length);
					ghost.segment.scale.x = length;
					ghost.segment.visible = true;
				}
			}
		}
	}
	else if (map.toggleMode == 'door') {
		//no preview while moving a door, or over one (a click there selects it)
		if (map.translateControls.door.isTranslating || getClicked3DPointAt(ghostPointer, Object.values(map.objects.doors), true)) { return; }

		var snap = walls.snapDoorToWalls(p.x, p.z, allWallSegments(), DOOR_SIZE.width, 0);
		ghost.door.position.x = snap ? snap.x : walls.snapHalf(p.x);
		ghost.door.position.z = snap ? snap.z : walls.snapHalf(p.z);
		ghost.door.rotation.y = snap ? snap.rotation : 0;
		ghost.door.visible = true;
	}
}

function getClicked3DPointAt(pointer, objects, recursive = false) {
	return getClicked3DPoint({ clientX: pointer.x, clientY: pointer.y }, objects, recursive);
}

var BUILD_HINTS = {
	points: 'Click to place wall points. Click the first point to close a room. Right-click or Esc to finish a wall.',
	room: 'Drag on the floor to draw a room. Right-drag turns the camera, arrow keys move it.',
	corridor: 'Drag on the floor to draw a corridor ' + CORRIDOR_WIDTH + ' squares wide. Right-drag turns the camera.',
	door: 'Click a wall to put a door in it, or drag a door along a wall. Click a door to turn it.'
};

function buildToolbar() {
	var toolbar = byId('build-toolbar');
	if (toolbar) { return toolbar; }

	toolbar = document.createElement('div');
	toolbar.id = 'build-toolbar';
	toolbar.className = 'noselect';
	toolbar.innerHTML =
		'<div class="build-tools">' +
			'<button type="button" data-tool="points" title="Draw walls point by point"><span class="material-icons">timeline</span><span>Walls</span></button>' +
			'<button type="button" data-tool="room" title="Drag out a closed room"><span class="material-icons">crop_square</span><span>Room</span></button>' +
			'<button type="button" data-tool="corridor" title="Drag out a corridor"><span class="material-icons">drag_handle</span><span>Corridor</span></button>' +
			'<button type="button" data-action="undo" title="Undo (Ctrl+Z / ⌘Z)"><span class="material-icons">undo</span><span>Undo</span></button>' +
		'</div>' +
		'<div class="build-hint"></div>';
	root.appendChild(toolbar);

	toolbar.addEventListener('click', function(e) {
		var button = e.target.closest('button');
		if (!button) { return; }

		if (button.dataset.action == 'undo') {
			undo();
		}
		else if (button.dataset.tool) {
			finishWall();
			map.wallTool = button.dataset.tool;
			syncBuildMode();
		}
	});

	return toolbar;
}

// Brings the toolbar, camera buttons and previews in line with the current mode and tool.
function syncBuildMode() {
	var dragTool = isDM && map.toggleMode == 'wallPoint' && map.wallTool != 'points';
	map.orbitControls.mouseButtons.LEFT = dragTool ? null : THREE.MOUSE.PAN;
	map.orbitControls.touches.ONE = dragTool ? null : THREE.TOUCH.PAN;

	var toolbar = buildToolbar();
	var building = isBuildMode();
	toolbar.style.display = building ? 'flex' : 'none';
	//lets the host page get its own overlays out of the toolbar's way
	root.classList.toggle('dmt-building', building);

	if (!building) {
		map.wallDrag = null;
		ghostPointer = null;
	}
	else {
		var walling = map.toggleMode == 'wallPoint';

		for (const button of toolbar.querySelectorAll('[data-tool]')) {
			button.style.display = walling ? '' : 'none';
			button.classList.toggle('active', walling && button.dataset.tool == map.wallTool);
		}

		toolbar.querySelector('.build-hint').textContent = BUILD_HINTS[walling ? map.wallTool : 'door'];
	}

	buildGhosts();
	scheduleGhosts();
}

function isTyping(e) {
	var target = e.target;
	return target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
}

function resizeToken(e, size) {
	hideContextMenu();

	if (map.menuTarget.scale.y == 1 && size < 0) {
		return false;
	}

	if (map.menuTarget.scale.y == 6 && size > 0) {
		return false;
	}

	map.menuTarget.scale.addScalar(size);

	var token = map.menuTarget;
	tokenScaleReposition(token);
	snapPosition(token);
	sendTokenMovement(token);

	//send to server	
	var args = {
		tokenId: token.tokenId,
		x: token.scale.x,
		y: token.scale.y,
		z: token.scale.z
	};
	
	sendMessage('update', 'updateTokenScale', args);
}

function addToken(e) {
	map.menuTarget = null;
	map.local.tokenListOffset = 0;

	//populate token pane
	var args = {
		parentId: 0,
		folderId: 0,
		limit: map.local.tokenListLimit,
		offset: map.local.tokenListOffset
	};

	sendMessage('request', 'getModels', args);
}

function editModel(e) {
	if (map.menuTarget.modelId in map.models) {
		var model = map.models[map.menuTarget.modelId];

		map.local.tokenFormData.name.value = model.name;
		map.local.tokenFormData.id.value = map.menuTarget.modelId;
		map.local.tokenFormData.src.value = model.src;
		map.local.tokenFormData.textureRepeatX.value = model.textureRepeat[0];
		map.local.tokenFormData.textureRepeatY.value = model.textureRepeat[1];
		map.local.tokenFormData.textureOffsetX.value = model.textureOffset[0];
		map.local.tokenFormData.textureOffsetY.value = model.textureOffset[1];
		map.local.tokenFormData.size.value = model.size;
		map.local.tokenFormData.scale.value = model.scale;
		map.local.tokenFormData.modelOffsetX.value = model.modelOffset[0];
		map.local.tokenFormData.modelOffsetY.value = model.modelOffset[1];
		map.local.tokenFormData.viewDistance.value = model.viewDistance;
		map.local.tokenFormData.baseColor.value = '#' + (model.baseColor).toString(16);

		var fileLabel = map.local.tokenFormData.file.element.querySelector('.pane-item-label-text');
		fileLabel.innerHTML = 'Image File (Leave blank if unchanged)';

		var tokenFile = byId('token_file');

		if (tokenFile != null) {
			tokenFile.value = '';
		}

		openPane(map.panes.new_token);
	}
}

function isFolderId(id) {
	return id !== undefined && id !== null && id !== false && id !== 0 && id !== '0' && id !== '';
}

function getModel(modelId) {
	//populate token pane
	var args = {
		modelId: modelId
	};

	sendMessage('request', 'getModel', args);
}

function changeTokenPage(folderId, parentId, offset) {
	var args = {
		parentId: parentId,
		folderId: folderId,
		limit: map.local.tokenListLimit,
		offset: offset
	};

	sendMessage('request', 'getModels', args);
}

function changePlanePage(folderId, parentId, offset) {
	var args = {
		parentId: parentId,
		folderId: folderId,
		limit: map.local.planeListLimit,
		offset: offset
	};

	sendMessage('request', 'getPlaneImages', args);
}

function addPlaneImage(e) {
	//populate images pane
	var args = {
		parentId: 0,
		folderId: 0,
		limit: map.local.planeListLimit,
		offset: map.local.planeListOffset
	};

	sendMessage('request', 'getPlaneImages', args);
}

function removePlaneImage(e) {
	hideContextMenu();
	
	var plane = map.menuTarget;

	if (plane.planeId in map.objects.planes) {
		sendMessage('update', 'removePlane', { planeId: plane.planeId });
		map.scaleControls.plane.detach();
		map.rotationControls.plane.detach();
		delete map.objects.planes[plane.planeId];
	}

	map.scene.remove(plane);
}

function resizeIframe(obj) {
	obj.style.height = obj.contentWindow.document.documentElement.scrollHeight + 'px';
}

function parseClickPos(event) {
	return new THREE.Vector2(ndcX(event.clientX), ndcY(event.clientY));
}

function getClicked3DPoint(event, objects, recursive) {
  //event.preventDefault();
  var mousePosition = parseClickPos(event);

  //raycaster
	var raycast = new THREE.Raycaster();
  raycast.setFromCamera(mousePosition, map.objects.camera);
  var intersects = raycast.intersectObjects(objects, recursive);	    

  if (intersects.length > 0) {
      return intersects;
  }
};

function removeToken(e) {
	hideContextMenu();
	
	if (map.menuTarget.tokenId in map.objects.tokens) {
		map.scene.remove(map.menuTarget)
		delete map.objects.tokens[map.menuTarget.tokenId];
		removeAvatar(map.menuTarget);
		
		sendMessage('update', 'removeToken', { tokenId: map.menuTarget.tokenId });
	}
}

function lookAtObject(object) {
	map.orbitControls.animating = true;
	map.objects.camera.newPosition = new THREE.Vector3(object.position.x - 2, 8, object.position.z + 12);
	map.orbitControls.newTarget = object.position.clone();
	
	if (object.name == 'token') {
		map.local.tokenVisionActive = object;
		updateVisionMeshes();
		updateTokenVision();
	}
}

function onResize() {

	map.objects.camera.aspect = viewWidth() / viewHeight();
	map.objects.camera.updateProjectionMatrix();

	map.composer.setSize( viewWidth() * (map.settings.renderFactor / 100), viewHeight() * (map.settings.renderFactor / 100) );
	map.renderer.setSize( viewWidth() * (map.settings.renderFactor / 100), viewHeight() * (map.settings.renderFactor / 100) );
	
	map.canvas.style.width = viewWidth() + 'px';
	map.canvas.style.height = viewHeight() + 'px';
}

function dragPane(pane, handle = false) {
	var pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
	if (handle !== false) {
		handle.onmousedown = dragMouseDown;
		handle.ontouchstart = dragMouseDown;
	}
	else {
		pane.onmousedown = dragMouseDown;
		pane.ontouchstart = dragMouseDown;
	}

	function dragMouseDown(e) {
		e = e || window.event;
		e.preventDefault();
		
		if ('touches' in e && e.touches.length > 0) {
			pos3 = e.touches[0].clientX;
			pos4 = e.touches[0].clientY;	    	
		}
		else {
			pos3 = e.clientX;
			pos4 = e.clientY;
		}

		//move pane to front
		var paneZIndex = 105;

		for (const [name, pane] of Object.entries(map.panes)) {
			if (pane.open) {
				if (pane.element != pane) {
					pane.element.style.zIndex = parseInt(pane.element.style.zIndex) - 1;
					paneZIndex++;
				}
			}
		}

		pane.style.zIndex = paneZIndex;
		

		document.onmouseup = closedragPane;
		document.onmousemove = elementDrag;
		
		document.ontouchend = closedragPane;
		document.ontouchmove = elementDrag;
	}

	function elementDrag(e) {
		e = e || window.event;
		e.preventDefault();
		
		if ('touches' in e && e.touches.length > 0) {
			pos1 = pos3 - e.touches[0].clientX;
			pos2 = pos4 - e.touches[0].clientY;
			pos3 = e.touches[0].clientX;
			pos4 = e.touches[0].clientY;	    	
		}
		else {
			pos1 = pos3 - e.clientX;
			pos2 = pos4 - e.clientY;
			pos3 = e.clientX;
			pos4 = e.clientY;
		}
		
		pane.style.top = (pane.offsetTop - pos2) + "px";
		pane.style.left = (pane.offsetLeft - pos1) + "px";
	}

	function closedragPane() {
		document.onmouseup = null;
		document.onmousemove = null;
		
		document.ontouchend = null;
		document.ontouchmove = null;
	}
}

function openPane(pane) {
	if (!pane.open) {
		pane.open = true;
		clearTimeout(pane.timer);
		pane.element.style.display = 'block';

		//move pane to front
		var paneZIndex = 105;

		for (const [name, currentPane] of Object.entries(map.panes)) {
			if (pane.open && pane != currentPane) {
				paneZIndex++;
			}
		}

		pane.element.style.zIndex = paneZIndex;
		
		setTimeout(function() {
			pane.element.style.opacity = '1';
		}, 0);
	}
}

function closePane(pane) {
	if (pane.open) {
		pane.open = false;
		pane.element.style.opacity = '0';
		pane.element.style.zIndex = 105;
		
		pane.timer = setTimeout(function() {
			pane.element.style.display = 'none';
		}, pane.transitionDuration);
	}
}

function buildPane(title, name = false) {
	if (!name) {
		name = title;	
	}
	
	var transitionDuration = 200;

	var pane = {
		name: name,
		title: title,
		element: document.createElement('div'),
		open: false,
		timer: false,
		transitionDuration: transitionDuration,
		items: []
	};

	pane.element.className = 'pane';
	var transition = 'opacity '+ transitionDuration +'ms ease-out';
	pane.element.style.transition = transition;
	pane.element.style.webkitTransition = transition;
	root.appendChild(pane.element);
	
	pane.header = {
		element: document.createElement('div'),
		title: document.createElement('div'),
		closeButton: document.createElement('div')
	}

	pane.header.title.className = 'pane-header-title';
	pane.header.title.innerHTML = title;
	pane.header.element.appendChild(pane.header.title);

	pane.header.element.className = 'pane-header';
	pane.element.appendChild(pane.header.element);
	dragPane(pane.element, pane.header.element);
	
	pane.header.closeButton.className = 'pane-close-button';
	pane.header.closeButton.addEventListener('click', function() { closePane(pane); }, false);
	pane.header.closeButton.addEventListener('touchend', function() { closePane(pane); }, false);
	pane.header.element.appendChild(pane.header.closeButton);
	
	var closeIcon = document.createElement('span');
	closeIcon.className = 'material-icons';
	closeIcon.innerHTML = 'close';
	pane.header.closeButton.appendChild(closeIcon);
	
	pane.body = document.createElement('div');
	pane.body.className = 'pane-body';
	pane.element.appendChild(pane.body);
	
	map.panes[name] = pane;

	return pane;
}

function buildPaneItem(pane, text, type, value = false, dmOnly = false, name = '') {
	var container = document.createElement('div');
	container.className = 'pane-item';
	container.style.display = !dmOnly || (dmOnly && isDM) ? 'block' : 'none';
	
	var input = null;
	
	var label = document.createElement('label');
	container.appendChild(label);

	var labelText = document.createElement('span');
	labelText.className = 'pane-item-label-text';
	labelText.innerHTML = text;
	label.appendChild(labelText);
	
	if (type == 'toggle') {
		var toggleSwitch = document.createElement('label');
		toggleSwitch.className = 'switch';
		label.appendChild(toggleSwitch);

		input = document.createElement('input');
		input.type = 'checkbox';
		input.checked = value;
		toggleSwitch.appendChild(input);
		
		var slider = document.createElement('span');
		slider.className = 'slider round';
		toggleSwitch.appendChild(slider);
	}
	
	if (type == 'number') {
		var inputNumberContainer = document.createElement('div');
		inputNumberContainer.className = 'input-number-container';
		label.appendChild(inputNumberContainer);

		var inputNumberDecrement = document.createElement('span');
		inputNumberDecrement.className = 'input-number-decrement';
		inputNumberContainer.appendChild(inputNumberDecrement);

		var decrementIcon = document.createElement('i');
		decrementIcon.className = 'material-icons';
		decrementIcon.innerHTML = 'remove';
		inputNumberDecrement.appendChild(decrementIcon);

		input = document.createElement('input');
		input.className = 'input-number';
		input.type = 'text';
		input.value = value;		

		var inputMinMax = function() {
			if (typeof(input.min) != 'undefined') {
				if (parseInt(input.value) < parseInt(input.min)) {
					input.value = parseInt(input.min);
				}
			}
			
			if (typeof(input.max) != 'undefined') {
				if (parseInt(input.value) > parseInt(input.max)) {
					input.value = parseInt(input.max);
				}
			}
		}

		input.addEventListener('change', inputMinMax, false);
		inputNumberContainer.appendChild(input);

		var inputNumberIncrement = document.createElement('span');
		inputNumberIncrement.className = 'input-number-increment';
		inputNumberContainer.appendChild(inputNumberIncrement);

		var incrementIcon = document.createElement('i');
		incrementIcon.className = 'material-icons';
		incrementIcon.innerHTML = 'add';
		inputNumberIncrement.appendChild(incrementIcon);

		inputNumberIncrement.addEventListener('click', function() {
			input.value++;
			inputMinMax();
			input.onchange();
		}, false);

		inputNumberDecrement.addEventListener('click', function() {
			input.value--;
			inputMinMax();
			input.onchange();
		}, false);
	}

	if (type == 'text-input') {
		input = document.createElement('input');
		input.className = 'input-text';
		input.type = 'text';
		input.value = value;
		label.appendChild(input);
	}

	if (type == 'select') {
		input = document.createElement('select');
		label.appendChild(input);
		
		if (Array.isArray(value)) {
			for (var i=0;i<value.length;i++) {
				var option = document.createElement('option');
				option.value = value[i].value;
				option.innerHTML = value[i].name;
				input.appendChild(option);
				
				if ('default' in value[i] && value[i].default) {
					input.selectedIndex = i;
				}
			}
		}
	}
	
	if (type == 'radio-segment') {
		var radioSegmentContainer = document.createElement('div');
		radioSegmentContainer.className = 'radio-segment';
		label.appendChild(radioSegmentContainer);
		
		if (Array.isArray(value)) {
			var inputName = text + Date.now();
			input = [];
			
			for (var i=0;i<value.length;i++) {
				var segmentLabel = document.createElement('label');
				radioSegmentContainer.appendChild(segmentLabel);
				
				var segmentInput = document.createElement('input');
				segmentInput.value = value[i].value;
				segmentInput.name = inputName;
				segmentInput.type = 'radio';
				input.push(segmentInput);
				segmentLabel.appendChild(segmentInput);
				
				var segmentName = document.createElement('span');
				segmentName.innerHTML = value[i].name;
				segmentLabel.appendChild(segmentName);
				
				if ('default' in value[i] && value[i].default) {
					segmentInput.checked = true;
				}
			}
		}
	}
	
	if (type == 'text') {
		var text = document.createElement('div');
		text.className = 'pane-item-text';
		text.innerHTML = value === false ? '' : value;
		label.appendChild(text);
	}

	if (type == 'header') {
		container.classList.add('pane-item-header');
	}
	
	if (type == 'folder') {
		container.classList.add('pane-container-folder-item');
		
		var folderContainer = document.createElement('div');
		folderContainer.className = 'pane-item-folder-container';
		label.prepend(folderContainer);

		var folder = document.createElement('span');
		folder.className = 'pane-item-folder material-icons';
		folder.innerHTML = 'folder';
		folderContainer.appendChild(folder);
		
		input = folder;
	}

	if (type == 'image') {
		container.classList.add('pane-container-image-item');
		
		var imageContainer = document.createElement('div');
		imageContainer.className = 'pane-item-image-container';
		label.prepend(imageContainer);
		
		var image = document.createElement('img');
		image.className = 'pane-item-image';
		image.src = value;
		imageContainer.appendChild(image);

		var imageDeleteButton = document.createElement('div');
		imageDeleteButton.className = 'pane-item-image-delete';
		imageDeleteButton.style.display = 'none';
		imageDeleteButton.innerHTML = '<span class="material-icons">remove_circle</span>';
		imageContainer.appendChild(imageDeleteButton);
		
		input = {
			image: image,
			deleteButton: imageDeleteButton
		}
	}

	if (type == 'pagination') {
		var pagination = document.createElement('div');
		pagination.className = 'pane-pagination';
		container.appendChild(pagination);

		var upButton = document.createElement('div');
		upButton.className = 'button button-3d noselect';
		var upButtonIcon = document.createElement('span');
		upButtonIcon.className = 'material-icons';
		upButtonIcon.innerHTML = 'arrow_upward';
		upButton.appendChild(upButtonIcon);
		pagination.appendChild(upButton);

		var nextButton = document.createElement('div');
		nextButton.className = 'button button-3d noselect';
		var nextButtonIcon = document.createElement('span');
		nextButtonIcon.className = 'material-icons';
		nextButtonIcon.innerHTML = 'navigate_next';
		nextButton.appendChild(nextButtonIcon);
		pagination.appendChild(nextButton);

		var prevButton = document.createElement('div');
		prevButton.className = 'button button-3d noselect';
		var prevButtonIcon = document.createElement('span');
		prevButtonIcon.className = 'material-icons';
		prevButtonIcon.innerHTML = 'navigate_before';
		prevButton.appendChild(prevButtonIcon);
		pagination.appendChild(prevButton);

		input = {
			up: upButton,
			next: nextButton,
			prev: prevButton
		}
	}

	if (type == 'button') {
		var button = document.createElement('div');
		button.className = 'pane-button button-primary button button-3d noselect';
		button.innerHTML = value;
		label.appendChild(button);
		container.style.height = '64px';

		input = button;
	}

	if (type == 'iframe') {
		var iframe = document.createElement('iframe');
		iframe.src = value;
		iframe.width = '100%';
		iframe.height = '100%';
		iframe.frameborder = '0';
		//iframe.scrolling = 'no';
		iframe.onload = 'resizeIframe(this)';

		(function() {

			var frame = iframe;

			window.addEventListener('resize', function() {
				resizeIframe(frame);
			}, false);
		}());

		container.appendChild(iframe);

		label.style.display = 'none';

		input = iframe;
	}
	
	var item = {
		name: name,
		text: text,
		type: type,
		element: container,
		input: input,
		dmOnly: dmOnly
	};

	pane.items.push(item);
	pane.body.appendChild(item.element);

	return item;
}

function buildSideButton(name, title, icon, dmOnly = false, helpText = false, inDemo = true) {
	var sideButton = { 
		element: document.createElement('div'),
		title: title,
		icon: icon,
		dmOnly: dmOnly,
		helpText: helpText
	}

	sideButton.element.className = 'side-button button button-3d button-plain button-circle button-jumbo noselect';
	sideButton.element.style.display = !dmOnly || (dmOnly && isDM) ? 'block' : 'none';
	sideButton.element.setAttribute('data-button', name);
	sideButton.element.title = title;
	
	if (demo) {
		sideButton.element.style.display = inDemo ? 'block' : 'none';
	}
	
	var sideButtonContainer = byId('side-button-container');
	if (sideButtonContainer != null) {
		sideButtonContainer.appendChild(sideButton.element);
	}

	var buttonIcon = document.createElement('span');
	buttonIcon.className = 'material-icons';
	buttonIcon.innerHTML = icon;
	sideButton.element.appendChild(buttonIcon);

	map.sideButtons[name] = sideButton;

	return sideButton;
}

function buildGui() {
	//alert pane
	var alertPane = buildPane('Alert', 'alert');
	buildPaneItem(alertPane, '', 'text', '');	

	//image pane
	var imagesPane = buildPane('Images', 'plane_images');
	
	var newPlanePane = buildPane('Images', 'new_plane_image');

	map.local.planeFormData = {
		name: buildPaneItem(newPlanePane, 'Name', 'text-input', '').input
	};

	var planeFile = `
	<div id="new-plane-form">
    	<input type="hidden" name="max_file_size" value="2097152">
    	<input id="plane_file" accept=".jpg,.jpeg,.png,.gif" type="file" name="pictures[]" multiple="false">
	</div>
	`;

	buildPaneItem(newPlanePane, 'Image File', 'text', planeFile);

	var planeFormButton = '<div id="new-plane-form-button" class="button button-3d button-primary">Submit</div>';
	var formButton = buildPaneItem(newPlanePane, '', 'text', planeFormButton);
	var formButtonElem = formButton.element.querySelector('#new-plane-form-button');

	// NOTE(port): uploads go through options.uploadPlane(formData) (the host app decides where
	// files are stored); the original posted to a hard-coded URL with jQuery.
	formButtonElem.addEventListener('click', async function() {
		var fd = new FormData();
		var files = byId('plane_file').files;

		if (files.length > 0 && options.uploadPlane) {
			fd.append('file', files[0]);
			fd.append('name', map.local.planeFormData.name.value);

			var data;

			try {
				data = await options.uploadPlane(fd);
			}
			catch (error) {
				console.warn('plane upload failed', error);
				notify('The image failed to upload.', 'error');
				return;
			}

			if (data && data.error) {
				notify(String(data.error), 'error');
			}
			else {
				closePane(newPlanePane);

				if (data && data.limit) {
					alertPane.body.innerHTML = '';

					buildPaneItem(alertPane, escapeHtml(data.limit.title), 'header');
					buildPaneItem(alertPane, escapeHtml(data.limit.description), 'text');

					openPane(alertPane);
				}
				else {
					//populate plane images pane
					var args = {
						parentId: 0,
						folderId: 0,
						limit: map.local.planeListLimit,
						offset: 0
					};

					sendMessage('request', 'getPlaneImages', args);
					notify('New image uploaded.');
				}
			}
		}
		else {
			notify('No file selected.');
		}
	}, false);

	
	//token pane
	var tokenPane = buildPane('Tokens', 'tokens');

	//new token pane
	var newTokenPane = buildPane('New Token', 'new_token');	

	map.local.tokenFormData = {
		name: buildPaneItem(newTokenPane, 'Name', 'text-input', map.local.tokenFormDefault.name).input,
		textureRepeatX: buildPaneItem(newTokenPane, 'Texture Repeat X', 'number', map.local.tokenFormDefault.textureRepeatX).input,
		textureRepeatY: buildPaneItem(newTokenPane, 'Texture Repeat Y', 'number', map.local.tokenFormDefault.textureRepeatY).input,
		textureOffsetX: buildPaneItem(newTokenPane, 'Texture Offset X', 'number', map.local.tokenFormDefault.textureOffsetX).input,
		textureOffsetY: buildPaneItem(newTokenPane, 'Texture Offset Y', 'number', map.local.tokenFormDefault.textureOffsetY).input,
		size: buildPaneItem(newTokenPane, 'Token Size (grid)', 'number', map.local.tokenFormDefault.size).input,
		scale: buildPaneItem(newTokenPane, 'Token Image Scale', 'number', map.local.tokenFormDefault.scale).input,
		modelOffsetX: buildPaneItem(newTokenPane, 'Model Offset X', 'number', map.local.tokenFormDefault.modelOffsetX).input,
		modelOffsetY: buildPaneItem(newTokenPane, 'Model Offset Y', 'number', map.local.tokenFormDefault.modelOffsetY).input,
		viewDistance: buildPaneItem(newTokenPane, 'View Distance (feet)', 'number', map.local.tokenFormDefault.viewDistance).input
	};

	var baseColor = buildPaneItem(newTokenPane, 'Base Colour', 'text', '<input id="baseColorInput" type="color" value="' + map.local.tokenFormDefault.baseColor + '">');
	var baseColorElem = baseColor.element.querySelector('#baseColorInput');
	map.local.tokenFormData.baseColor = baseColorElem;

	var tokenFile = `
	<div id="new-token-form">
    	<input id="token_id" type="hidden" value="">
    	<input id="token_src" type="hidden" value="">
    	<input type="hidden" name="max_file_size" value="2097152">
    	<input id="token_file" accept=".jpg,.jpeg,.png,.gif" type="file" name="pictures[]" multiple="false">
	</div>
	`;

	map.local.tokenFormData.file = buildPaneItem(newTokenPane, 'Image File', 'text', tokenFile);
	map.local.tokenFormData.id = byId('token_id');
	map.local.tokenFormData.src = byId('token_src');

	var tokenFormButton = '<div id="new-token-form-button" class="button button-3d button-primary">Submit</div>';
	var formButton = buildPaneItem(newTokenPane, '', 'text', tokenFormButton);
	var formButtonElem = formButton.element.querySelector('#new-token-form-button');

	formButtonElem.addEventListener('click', async function() {

		var fd = new FormData();
		var files = byId('token_file').files;

		if (!options.uploadModel) { return; }

		if (files.length > 0 || (map.menuTarget != null && map.local.tokenFormData.src.value != '')) {
			for (var key in map.local.tokenFormData) {
				if (key === 'file') { continue; }
			    fd.append(key, map.local.tokenFormData[key].value);
			}

			if (files.length > 0) {
				fd.append('file', files[0]);
			}

			var data;

			try {
				data = await options.uploadModel(fd);
			}
			catch (error) {
				console.warn('token upload failed', error);
				notify('The token failed to upload.', 'error');
				return;
			}

			if (data && data.error) {
				notify(String(data.error), 'error');
			}
			else {
				closePane(newTokenPane);

				if (data && data.limit) {
					alertPane.body.innerHTML = '';

					buildPaneItem(alertPane, escapeHtml(data.limit.title), 'header');
					buildPaneItem(alertPane, escapeHtml(data.limit.description), 'text');

					closePane(newTokenPane);
					openPane(alertPane);
				}
				else if (data && data.model && 'id' in data.model) {
					var args = {
						modelId: data.model.id
					};

					var model = {
						modelId: data.model.id,
						name: data.model.name,
						src: data.model.src,
						textureRepeatX: data.model.textureRepeatX,
						textureRepeatY: data.model.textureRepeatY,
						textureOffsetX: data.model.textureOffsetX,
						textureOffsetY: data.model.textureOffsetY,
						size: data.model.size,
						scale: data.model.scale,
						modelOffsetX: data.model.modelOffsetX,
						modelOffsetY: data.model.modelOffsetY,
						viewDistance: data.model.viewDistance,
						baseColor: data.model.baseColor
					};

					if (data.model.id in map.models) { 		//existing model
						updateClient.editModel(model);
						sendMessage('update', 'editModel', args);
					}
					else {
						clientRequest.getModel(model);
					}
				}
			}
		}
		else {
			notify('No file selected.');
		}
	}, false);
	
	//token settings pane	
	var tokenSettingsPane = buildPane('Token Settings', 'token_settings');

	//hide avatar setting
	var hideAvatarSetting = [
		{ value: 0, name: 'Off', default: true },
		{ value: 1, name: 'On' }
	];	
	var hideAvatar = buildPaneItem(tokenSettingsPane, 'Hide token\'s avatar', 'radio-segment', hideAvatarSetting, false, 'hideAvatar');	
	for (const hideAvatarSetting of hideAvatar.input) {
		hideAvatarSetting.addEventListener('change', hideAvatarSetting.fn = function() {
			if (map.menuTarget.tokenId in map.objects.tokens) {
				const token = map.objects.tokens[map.menuTarget.tokenId];
				token.avatar.classList[parseInt(this.value) ? 'add' : 'remove']('avatar-hidden');
				token.settings.hideAvatar = parseInt(this.value);
				updateTokenSettings(token);
			}
		});
	}

	//look at camera setting	
	var lookAtCamSetting = [
		{ value: 0, name: 'Off', default: true },
		{ value: 1, name: 'On' }
	];	
	var lookAtCam = buildPaneItem(tokenSettingsPane, 'Disable Look at Camera', 'radio-segment', lookAtCamSetting, false, 'disableCamLook');	
	for (const lookAtCamSetting of lookAtCam.input) {
		lookAtCamSetting.addEventListener('change', lookAtCamSetting.fn = function() {
			if (map.menuTarget.tokenId in map.objects.tokens) {
				const token = map.objects.tokens[map.menuTarget.tokenId];				
				token.settings.disableCamLook = parseInt(this.value);
				token.rotation.y = 0;
				updateTokenSettings(token);
			}
		});
	}
	
	//settings pane
	var settingsPane = buildPane('Settings', 'settings');
	
	//global graphics settings
	var globalGraphicsOptions = [
		{ value: 0, name: 'Low' },
		{ value: 1, name: 'Medium' },
		{ value: 2, name: 'High' }
	];
	globalGraphicsOptions[map.settings.preset].default = true;

	buildPaneItem(settingsPane, 'Graphics', 'header');	
	var globalGraphics = buildPaneItem(settingsPane, 'Graphics Presets', 'radio-segment', globalGraphicsOptions);
	map.panes.settings.globalGraphics = globalGraphics;

	buildPaneItem(settingsPane, 'Advanced Graphics', 'header');

	//lighting
	var lightingQualitySettings = [
		{ value: 0, name: 'Low' },
		{ value: 1, name: 'Medium' },
		{ value: 2, name: 'High'}
	];
	lightingQualitySettings[map.settings.lightingQuality].default = true;

	var lightingQuality = buildPaneItem(settingsPane, 'Lighting Quality', 'radio-segment', lightingQualitySettings);
	for (var i=0;i<lightingQuality.input.length;i++) {
		lightingQuality.input[i].addEventListener('change', lightingQuality.input[i].fn = function() {
			
			map.settings.lightingQuality = parseInt(this.value);
			saveSettings();

			var lightIntensity = map.objects.light.intensity;
			var lightColor = map.objects.light.color;
			map.scene.remove(map.objects.light);

			switch (parseInt(this.value)) {
				case 0: 	//ambient
				case 1:
					map.objects.light = new THREE.AmbientLight( 0xffffff, 1 );
					map.objects.light.intensity = lightIntensity;
					map.objects.light.color = lightColor;
					break;
				case 2:   //hemi
					map.objects.light = new THREE.HemisphereLight( 0xffffff, 0x777777, 1 );
					map.objects.light.intensity = lightIntensity;
					map.objects.light.color = lightColor;
					break;
			}

			map.scene.add(map.objects.light);
		}, false);
	}

	//vision mask calculation points
	var maskPointOptions = [
		{ value: 80, name: 'Low' },
		{ value: 120, name: 'Medium' },
		{ value: 160, name: 'High' }
	];

	for (var i=0;i<maskPointOptions.length;i++) {
		if (maskPointOptions[i].value == map.settings.maskPoints) {
			maskPointOptions[i].default = true;
			break;
		}
	}

	var maskPoints = buildPaneItem(settingsPane, 'Vision cone accuracy', 'radio-segment', maskPointOptions);
	for (var i=0;i<maskPoints.input.length;i++) {
		maskPoints.input[i].addEventListener('change', maskPoints.input[i].fn = function() {
			map.settings.maskPoints = parseInt(this.value);
			saveSettings();
		}, false);
	}

	//internal rendering resolution %
	var renderFactor = buildPaneItem(settingsPane, 'Internal rendering resolution %', 'number', map.settings.renderFactor);
	renderFactor.input.min = 10;
	renderFactor.input.max = 200;
	renderFactor.input.addEventListener('change', renderFactor.input.fn = function() {
		map.settings.renderFactor = renderFactor.input.value;
		saveSettings();
		onResize();
	}, false);

	//Token Texture max size
	var maxTokenTextureSizeOptions = [
		{ value: 256, name: 'Low' },
		{ value: 512, name: 'Medium' },
		{ value: 1024, name: 'High' }
	];

	for (var i=0;i<maxTokenTextureSizeOptions.length;i++) {
		if (maxTokenTextureSizeOptions[i].value == map.settings.maxTokenTextureSize) {
			maxTokenTextureSizeOptions[i].default = true;
			break;
		}
	}

	var maxTokenTextureSize = buildPaneItem(settingsPane, 'Token Texture Quality', 'radio-segment', maxTokenTextureSizeOptions);
	for (var i=0;i<maxTokenTextureSize.input.length;i++) {
		maxTokenTextureSize.input[i].addEventListener('change', maxTokenTextureSize.input[i].fn = function() {
			map.settings.maxTokenTextureSize = parseInt(this.value);
			saveSettings();
			updateTokenTextureSize(map.settings.maxTokenTextureSize);
		}, false);
	}

	//Plane Texture max size
	var maxPlaneTextureSizeOptions = [
		{ value: 1024, name: 'Low' },
		{ value: 2048, name: 'Medium' },
		{ value: 4096, name: 'High' }
	];

	for (var i=0;i<maxPlaneTextureSizeOptions.length;i++) {
		if (maxPlaneTextureSizeOptions[i].value == map.settings.maxPlaneTextureSize) {
			maxPlaneTextureSizeOptions[i].default = true;
			break;
		}
	}

	var maxPlaneTextureSize = buildPaneItem(settingsPane, 'Background Texture Quality', 'radio-segment', maxPlaneTextureSizeOptions);
	for (var i=0;i<maxPlaneTextureSize.input.length;i++) {
		maxPlaneTextureSize.input[i].addEventListener('change', maxPlaneTextureSize.input[i].fn = function() {
			map.settings.maxPlaneTextureSize = parseInt(this.value);
			saveSettings();

			for (const [planeId, plane] of Object.entries(map.objects.planes)) {
				var src = options.imageUrl({ kind: 'plane', src: plane.src, size: map.settings.maxPlaneTextureSize, quality: map.settings.maxPlaneTextureQuality });
				var texture = new THREE.TextureLoader().load(src);
				plane.material.map.dispose();
				plane.material.map = texture;
			}

		}, false);
	}

	//view distance
	var viewDistanceOptions = [
		{ value: 100, name: 'Low' },
		{ value: 200, name: 'Medium' },		
		{ value: 500, name: 'High' }
	];

	for (var i=0;i<viewDistanceOptions.length;i++) {
		if (viewDistanceOptions[i].value == map.settings.viewDistance) {
			viewDistanceOptions[i].default = true;
			break;
		}
	}

	var viewDistance = buildPaneItem(settingsPane, 'View Distance', 'radio-segment', viewDistanceOptions);
	for (var i=0;i<viewDistance.input.length;i++) {
		viewDistance.input[i].addEventListener('change', viewDistance.input[i].fn = function() {
			map.settings.viewDistance = parseInt(this.value);
			map.skybox.scale.set(map.settings.viewDistance, map.settings.viewDistance, map.settings.viewDistance);
			saveSettings();
			map.objects.camera.far = parseInt(this.value);
			map.objects.camera.updateProjectionMatrix();
		}, false);
	}

	//fov
	var fov = buildPaneItem(settingsPane, 'Field of View', 'number', map.settings.fov);
	fov.input.min = 10;
	fov.input.max = 120;
	fov.input.onchange = function() {
		map.settings.fov = fov.input.value;
		saveSettings();
		map.objects.camera.fov = fov.input.value;
		map.objects.camera.updateProjectionMatrix();
	};		

	//camera damping
	var cameraDamping = buildPaneItem(settingsPane, 'Camera Damping', 'toggle', map.settings.cameraDamping);
	cameraDamping.input.addEventListener('change', cameraDamping.input.fn = function() {
		map.settings.cameraDamping = this.checked;
		saveSettings();
		map.orbitControls.enableDamping = map.settings.cameraDamping ? true : false;
	}, false);	

	buildPaneItem(settingsPane, 'Other', 'header');	
	
	//token position updates
	var tokenUpdates = buildPaneItem(settingsPane, 'Update Token Position on Drag', 'toggle', map.settings.dragUpdate);
	tokenUpdates.input.addEventListener('change', function() {
		map.settings.dragUpdate = this.checked;
		saveSettings();
	}, false);	

	//token position snap
	var tokenSnapPos = buildPaneItem(settingsPane, 'Snap Token Position on Drag', 'toggle', map.settings.snapTokenPos);
	tokenSnapPos.input.addEventListener('change', function() {
		map.settings.snapTokenPos = this.checked;
		saveSettings();
	}, false);

	//token snap lighting
	var tokenSnapLighting = buildPaneItem(settingsPane, 'Update Token Vision to grid', 'toggle', map.settings.snapLighting);
	tokenSnapLighting.input.addEventListener('change', function() {
		map.settings.snapLighting = this.checked;
		saveSettings();
	}, false);
	
	//tokens look at camera
	var tokenLookAtCam = buildPaneItem(settingsPane, 'Tokens Look at Camera', 'toggle', map.settings.lookAtCam);
	tokenLookAtCam.input.addEventListener('change', tokenLookAtCam.input.fn = function() {
		map.settings.lookAtCam = this.checked;
		saveSettings();

		for (const [tokenId, token] of Object.entries(map.objects.tokens)) {
			token.rotation.y = 0;
		}
	}, false);
	
	//grid width
	var gridWidth = buildPaneItem(settingsPane, 'Grid Width', 'number', map.settings.gridWidth, true);
	gridWidth.input.min = 2;
	gridWidth.input.max = MAX_GRID_SIZE;
	gridWidth.input.onchange = function() {
		// a whole number in the range the server accepts (the input's value is text)
		map.settings.gridWidth = clampGridSize(gridWidth.input.value);
		gridWidth.input.value = map.settings.gridWidth;
		saveSettings();
		updateGridSize();
	};
	
	//grid height
	var gridHeight = buildPaneItem(settingsPane, 'Grid Height', 'number', map.settings.gridHeight, true);
	gridHeight.input.min = 2;
	gridHeight.input.max = MAX_GRID_SIZE;
	gridHeight.input.onchange = function() {
		// a whole number in the range the server accepts (the input's value is text)
		map.settings.gridHeight = clampGridSize(gridHeight.input.value);
		gridHeight.input.value = map.settings.gridHeight;
		saveSettings();
		updateGridSize();
	};

	//global settings binding
	for (var i=0;i<globalGraphics.input.length;i++) {
		globalGraphics.input[i].addEventListener('change', function() {
			map.settings.preset = parseInt(this.value);

			switch (parseInt(this.value)) {
				case 0:
					maskPoints.input.value = 80;
					fov.input.value = 20;
					cameraDamping.input.checked = false;
					tokenLookAtCam.input.checked = false;
					break;
				case 1:
					maskPoints.input.value = 120;
					fov.input.value = 28;
					cameraDamping.input.checked = false;
					tokenLookAtCam.input.checked = false;
					break;
				case 2:
					maskPoints.input.value = 160;
					fov.input.value = 36;
					cameraDamping.input.checked = true;
					tokenLookAtCam.input.checked = true;
					break;
			}
			
			fov.input.onchange();
			cameraDamping.input.fn();
			tokenLookAtCam.input.fn();
			
			for (var i=0;i<globalGraphicsOptions.length;i++) {
				lightingQuality.input[i].checked = (i == this.value);
				maskPoints.input[i].checked = (i == this.value);
				maxTokenTextureSize.input[i].checked = (i == this.value);
				maxPlaneTextureSize.input[i].checked = (i == this.value);
				viewDistance.input[i].checked = (i == this.value);
				
				if (i == this.value) {
					lightingQuality.input[i].fn();
					maskPoints.input[i].fn();
					maxTokenTextureSize.input[i].fn();
					maxPlaneTextureSize.input[i].fn();
					viewDistance.input[i].fn();					
				}
			}
		}, false);
	}

	

	//initiative tracker
	var initiativePane = buildPane('Initiative Tracker', 'initiative');
	initiativePane.element.style.height = '100%';

	//side buttons
	var sideButtonContainer = document.createElement('div');
	sideButtonContainer.id = 'side-button-container';
	root.appendChild(sideButtonContainer);

	//help button
	var helpButton = buildSideButton('help', 'Help', 'help_outline');
	helpButton.element.addEventListener('click', function() {
		helpPane.open ? closePane(helpPane) : openPane(helpPane);
	}, false);

	//settings button
	var settingsButton = buildSideButton('settings', 'Settings', 'settings', false, 'Change Dungeons settings.');
	settingsButton.element.addEventListener('click', function() {
		settingsPane.open ? closePane(settingsPane) : openPane(settingsPane);
	}, false);

	//Initiative tracker button
	var frameLoaded = false;

	// NOTE(port): the embedded tracker is only offered when the host app gives a trackerUrl.
	var initiativeButton = buildSideButton('tracker', 'Initiative Tracker', 'list', true, 'Opens the initiative tracker inside the tabletop.');
	if (!options.trackerUrl) {
		initiativeButton.element.style.display = 'none';
		initiativeButton.unavailable = true;
	}
	initiativeButton.element.addEventListener('click', function() {
		
		if (initiativePane.open) {
			closePane(initiativePane);
		}
		else {
			if (!frameLoaded) {
				var frameItem = buildPaneItem(initiativePane, '', 'iframe', options.trackerUrl, true);
				frameItem.input.style.minWidth = '1024px';
				frameLoaded = true;
			}
			openPane(initiativePane);
		}
	}, false);

	//room pane
	buildPane('Manage Rooms', 'rooms');

	//new rooms pane
	var newRoomsPane = buildPane('New Room', 'new_room');
	map.local.roomFormData = {
		name: buildPaneItem(newRoomsPane, 'Name', 'text-input', map.local.tokenFormDefault.name).input
	}
	var roomFormButton = '<div id="new-room-form-button" class="button button-3d button-primary">Submit</div>';
	var roomFormButtonItem = buildPaneItem(newRoomsPane, '', 'text', roomFormButton);
	var roomFormButtonElem = roomFormButtonItem.element.querySelector('#new-room-form-button');

	roomFormButtonElem.addEventListener('click', function() {

		var args = {
			name: map.local.roomFormData.name.value
		};

		sendMessage('request', 'addRoom', args);
	}, false);

	//room button
	var roomButton = buildSideButton('rooms', 'Manage Rooms', 'place', true, 'Allows you to create, delete & move to other rooms/maps in the campaign.', false);
	roomButton.element.addEventListener('click', function() {
		sendMessage('request', 'getRooms', {});
	}, false);
	
	//edit toglle buttons
	var doorModeButton = buildSideButton('doorMode', 'Door Mode', 'door_front', true, 'Toggles door mode. Allows you to add, move, rotate & delete doors.');
	var wallModeButton = buildSideButton('wallMode', 'Wall Mode', 'view_carousel', true, 'Toggles wall edit mode. Allows you to add, move & delete wall points.');
	var planeModeButton = buildSideButton('planeMode', 'Plane Mode', 'image', true, 'Toggles plane image edit mode. Allows you to add, move & delete image planes.');

	//doors button
	doorModeButton.element.addEventListener('click', function() {
		
		if (map.toggleMode == 'plane') { planeModeButton.element.click(); }		//turn off plane mode
		if (map.toggleMode == 'wallPoint') { wallModeButton.element.click(); }			//turn off wall mode

		map.toggleMode = map.toggleMode == 'door' ? 'token' : 'door';
		map.translateControls.door.enabled = map.toggleMode == 'door';
		map.rotationControls.door.enabled = map.toggleMode == 'door';

		map.translateControls.token.enabled = map.toggleMode == 'token';

		if (map.toggleMode == 'door') {
			map.translateControls.door.enabled = true;
		}
		else {
			map.rotationControls.door.detach();
		}

		clearGroupSelection();
		doorModeButton.element.classList.toggle('active');
		syncBuildMode();
	}, false);

	//walls button
	wallModeButton.element.addEventListener('click', function() {
		
		if (map.toggleMode == 'plane') { planeModeButton.element.click(); }		//turn off plane mode
		if (map.toggleMode == 'door') { doorModeButton.element.click(); }			//turn off door mode

		map.toggleMode = map.toggleMode == 'wallPoint' ? 'token' : 'wallPoint';
		map.translateControls.wallPoint.enabled = map.toggleMode == 'wallPoint';

		map.translateControls.token.enabled = map.toggleMode == 'token';

		clearGroupSelection();
		wallModeButton.element.classList.toggle('active');
		
		if (map.toggleMode == 'wallPoint') {
			addWallGroup();
		}

		//show wall points
		for (const [wallPointGroupId, wallPointGroup] of Object.entries(map.wallPointGroups)) {
			for (const [wallPointId, wallPoint] of Object.entries(wallPointGroup.points)) {
				wallPoint.visible = map.toggleMode == 'wallPoint';
			}
		}

		syncBuildMode();
	}, false);

	//plane mode button
	planeModeButton.element.addEventListener('click', function() {
		
		if (map.toggleMode == 'wallPoint') { wallModeButton.element.click(); }		//turn off wall mode
		if (map.toggleMode == 'door') { doorModeButton.element.click(); }			//turn off door mode

		map.toggleMode = map.toggleMode == 'plane' ? 'token' : 'plane';
		map.translateControls.token.enabled = map.toggleMode == 'token';
		
		map.rotationControls.plane.enabled = map.toggleMode == 'plane';
		map.translateControls.plane.enabled = map.toggleMode == 'plane';
		map.scaleControls.plane.enabled = map.toggleMode == 'plane';

		if (map.toggleMode == 'plane') {
			map.translateControls.plane.enabled = true;
		}
		else {
			map.rotationControls.plane.detach();
			map.scaleControls.plane.detach();
		}

		clearGroupSelection();
		planeModeButton.element.classList.toggle('active');
		syncBuildMode();
	}, false);

	//select mode button
	var selectModeButton = buildSideButton('selectMode', 'Select Mode', 'highlight_alt', false, 'Allows you to select multiple objects to move at once.');
	selectModeButton.element.addEventListener('click', function() {
		map.selectModeActive = !map.selectModeActive;

		map.orbitControls.enablePan = !map.selectModeActive;
		map.orbitControls.enableRotate = !map.selectModeActive;

		map.selectionHelper.enabled = map.selectModeActive;

		selectModeButton.element.classList.toggle('active');
	}, false);

	//translate mode
	var translateModeButton = buildSideButton('translateMode', 'Vertical Movement', 'height', false, 'Toggle vertical movement mode.');
	translateModeButton.element.addEventListener('click', function() {
		map.local.verticalTranslate = !map.local.verticalTranslate;

		map.translateControls.token.translateMode = map.local.verticalTranslate ? 'vertical' : 'horizontal';

		translateModeButton.element.classList.toggle('active');
	}, false);

	//daylight button
	var daylightButton = buildSideButton('daylight', 'Daylight', 'brightness_6', true, 'Toggles tokens vision range from \'darkness\' to \'daylight\'.');
	daylightButton.element.addEventListener('click', function() {

		if (isDM) {
			daylightButton.element.classList.toggle('active');

			map.local.daylight = map.local.daylight ? 0 : 1;
			map.objects.light.intensity = lightLevel(map.local.daylight ? 1.1 : 0.9);

			updateTokenVision();

			var args = {
				daylight: map.local.daylight
			};

			//send to server	
			sendMessage('update', 'updateDaylight', args);
		}

	}, false);

	if (map.local.daylight) {
		daylightButton.element.classList.add('active');
	}

	//moonlight button
	var moonlightButton = buildSideButton('moonlight', 'Moonlight', 'nightlight', true, 'Toggles \'moonlight\' mode for ambient lighting at night.');
	moonlightButton.element.addEventListener('click', function() {

		if (isDM) {
			moonlightButton.element.classList.toggle('active');
			
			var args = {
				moonlight: map.local.moonlight ? 0 : 1
			};

			updateClient.updateMoonlight(args);

			//send to server	
			sendMessage('update', 'updateMoonlight', args);
		}

	}, false);

	if (map.local.moonlight) {
		moonlightButton.element.classList.add('active');
	}

	//light toggle button
	/*
	DM Light

	0: opaque
	1: translucent
	2: transparent

	*/
	var toggleView = buildSideButton('dmView', 'Toggle DM View', 'highlight', true, 'Switches the fog of war between, opaque, translucent & clear. Token collision is enabled in opaque mode.');
	toggleView.element.addEventListener('click', function() {

		map.local.dmLight = (map.local.dmLight + 1) % 3;

		switch (map.local.dmLight) {
			case 0:
				map.mask.mesh.material.opacity = 1;
				break;
			case 1:
				map.mask.mesh.material.opacity = DM_FOG_OPACITY;
				break;
			case 2:
				map.mask.mesh.material.opacity = 0;
				break;
		}

		if (map.local.dmLight > 0) {
			for (const [tokenId, token] of Object.entries(map.objects.tokens)) {
				token.visible = true;
			}
		}

		updateVisionMeshes();
		updateTokenVision();
	}, false);

	//cam focus button
	var camFocusIndicator = document.createElement('div');
	camFocusIndicator.id = 'camFocusIndicator';
	root.appendChild(camFocusIndicator);

	var camFocus = buildSideButton('focus', 'Focus Camera', 'photo_camera', true, 'Moves all players\' vision to DM\'s point of view & DM\'s current room.', false);
	camFocus.element.addEventListener('click', function() {
		
		camFocusIndicator.classList.add('camFocusIndicatorAnim');
		setTimeout(function() {
			camFocusIndicator.classList.remove('camFocusIndicatorAnim');
		}, 1000);

		var args = {
			xpos: map.objects.camera.position.x,
			ypos: map.objects.camera.position.y,
			zpos: map.objects.camera.position.z,
			xtarget: map.orbitControls.target.x,
			ytarget: map.orbitControls.target.y,
			ztarget: map.orbitControls.target.z,
		};

		sendMessage('update', 'focusCamera', args);
	}, false);

	//welcome pane
	//demo pane
	if (demo) {
		var demoPane = buildPane('Welcome to the demo', 'welcome');
		buildPaneItem(demoPane, 'You are in <b>demo mode</b>: you can try out the tabletop features here, but nothing is saved or shared. Connect the viewer to a tabletop server to play with others.', 'text', '');
		openPane(demoPane);
	}

	//share button
	// NOTE(port): invites are a host-app feature: the button exists only when options.inviteLink
	// is given, and the invite code comes from the host app (room state or a refreshInviteCode
	// request).
	var shareButton = buildSideButton('invite', 'Get Invite Link', 'send', true, 'Copies an invite link to your clipboard.', false);
	shareButton.element.id = 'shareButtonId';

	if (!options.inviteLink) {
		shareButton.element.style.display = 'none';
		shareButton.unavailable = true;
	}

	shareButton.element.addEventListener('click', function() {
		if (map.inviteCode && map.inviteCode !== '0') {
			copyInviteLink();
		}
		else {
			sendMessage('request', 'refreshInviteCode', {});
		}
	}, false);

	//help pane
	var helpPane = buildPane('Help');

	buildPaneItem(helpPane, 'Controls', 'header');
	buildPaneItem(helpPane, 'Left Drag / 1 Touch Drag', 'text', 'Pan');
	buildPaneItem(helpPane, 'Right Drag / 2 Touch Drag', 'text', 'Rotate / Move token vertically');
	buildPaneItem(helpPane, 'Scroll Wheel / 2 Touch Pinch', 'text', 'Zoom Camera');
	buildPaneItem(helpPane, 'Double Click', 'text', 'Ping Location');
	buildPaneItem(helpPane, 'Ctrl Key', 'text', 'Free scale/rotate images');
	buildPaneItem(helpPane, 'Shift Key', 'text', 'Toggle Box Select');
	
	//sidebar buttons help
	buildPaneItem(helpPane, 'Sidebar Buttons', 'header');

	for (const [name, sideButton] of Object.entries(map.sideButtons)) {
		if (name == 'help') { continue; }

		var helpText = '<b>' + sideButton.title + '</b>';

		if (sideButton.helpText !== false) {
			helpText += ' - ' + sideButton.helpText;
		}

		buildPaneItem(helpPane, '<i class="pane-help-icons material-icons">' + sideButton.icon + '</i>', 'text', helpText, sideButton.dmOnly);
	}
}

function updateGuiItems(dm) {
	//update pane items
	for (const [name, pane] of Object.entries(map.panes)) {
		for (var j=0;j<pane.items.length;j++) {
			if (pane.items[j].dmOnly) {
				pane.items[j].element.style.display = dm ? 'block' : 'none';
			}
		}
	}

	//update side buttons
	for (const [name, sideButton] of Object.entries(map.sideButtons)) {
		if (sideButton.dmOnly) {
			sideButton.element.style.display = (dm && !sideButton.unavailable) ? 'block' : 'none';
		}
	}
}

// Frees GPU memory held by an object and its children.
function disposeObject(object) {
	object.traverse(function(child) {
		if (child.geometry && !child.geometry.userData.shared) { child.geometry.dispose(); }

		if (child.material) {
			var materials = Array.isArray(child.material) ? child.material : [child.material];

			for (const material of materials) {
				if (material.userData.shared) { continue; }	//used by every door / wall
				if (material.map) { material.map.dispose(); }
				material.dispose();
			}
		}
	});
}

// NOTE(port): new. Removes everything that buildRoom() created, so that the full state received
// after a reconnect (or when switching rooms) can be built again without duplicating tokens,
// planes, doors, walls or the player list. Camera, settings and the GUI are kept.
function resetRoom() {
	if (!map.translateControls.token) { return; }	//scene not initialised yet

	map.rotationControls.door.detach();
	map.rotationControls.plane.detach();
	map.scaleControls.plane.detach();
	clearGroupSelection();

	for (const token of Object.values(map.objects.tokens)) {
		removeAvatar(token);
		map.scene.remove(token);
		disposeObject(token);
	}

	for (const plane of Object.values(map.objects.planes)) {
		map.scene.remove(plane);
		disposeObject(plane);
	}

	for (const door of Object.values(map.objects.doors)) {
		map.scene.remove(door);
		disposeObject(door);
	}

	for (const wallPointGroup of Object.values(map.wallPointGroups)) {
		for (const wallPoint of Object.values(wallPointGroup.points)) {
			map.scene.remove(wallPoint);
			disposeObject(wallPoint);
		}

		if (wallPointGroup.mesh) {
			map.scene.remove(wallPointGroup.mesh);
			disposeObject(wallPointGroup.mesh);
		}
	}

	map.objects.tokens = {};
	map.objects.planes = {};
	map.objects.doors = {};
	map.wallPointGroups = {};
	map.wallPointGroupActive = false;
	map.models = {};
	map.users = {};
	map.visionMeshes = [];
	map.menuTarget = null;
	map.local.tokenVisionActive = false;
	map.hover.targets.length = 0;
	map.outlinePass.selectedObjects = [];

	for (const controls of Object.values(map.translateControls)) {
		controls.translateObjects.length = 0;
		controls.object = null;
	}

	for (const element of [byId('user-section'), byId('avatarContainer')]) {
		if (element != null) { element.parentNode.removeChild(element); }
	}

	//fog of war back to "nothing revealed"
	map.mask.fog.reset();

	//the role is decided again by the state we are about to receive
	isDM = demo ? true : false;
	map.mask.mesh.material.opacity = isDM ? DM_FOG_OPACITY : 1;
	map.local.dmLight = isDM ? 1 : 0;
}

var roomBuilds = 0;

function buildRoom(room) {
	map.loadItemCount = 0;
	roomBuilds++;
	
	//add invite code
	if ('inviteCode' in room) {
		map.inviteCode = room.inviteCode;
	}

	//check if current user is dm
	if ('dm' in room) {
		if (String(room.dm) === String(user_id)) {
			isDM = true;
			map.mask.mesh.material.opacity = DM_FOG_OPACITY;
		}
	}

	//daylight
	if ('daylight' in room) {
		map.local.daylight = room.daylight;
		map.objects.light.intensity = lightLevel(map.local.daylight ? 1.1 : 0.9);

		updateClient.updateDaylight({
			daylight: map.local.daylight
		});
	}

	//moonlight
	if ('moonlight' in room) {
		map.local.moonlight = room.moonlight;

		updateClient.updateMoonlight({
			moonlight: map.local.moonlight
		});
	}
	
	//size grid
	if ('grid' in room) {
		map.settings.gridWidth = parseData.int(room.grid.width);
		map.settings.gridHeight = parseData.int(room.grid.height);
		updateGridSize(false);
	}
	
	//build client list
	if ('clients' in room) {
		map.users = room.clients;

		var userSection = document.createElement('div');
		userSection.id = 'user-section';
		root.appendChild(userSection);

		var i=0;

		for (const [userId, user] of Object.entries(map.users)) {
			user.color = rainbow(10, i);
			i++;
			// NOTE(port): the host app decides what an avatar looks like (options.avatarUrl).
			user.picture = options.avatarUrl({ userId: userId, name: user.name });
			
			if (user.live) {
				updateClient.clientConnected({
					user_id: userId,
					name: user.name,
					picture: user.picture
				});
			}
			
			if ('camera' in user) {
				var position = user.camera.position;
				map.objects.camera.position.set(position.x, position.y, position.z);

				var target = user.camera.target;
				map.orbitControls.target.set(target.x, target.y, target.z);
			}
		}
	}

	//build all walls once at the end instead of once per point (big maps load much faster)
	map.deferWalls = true;

	//add doors
	if ('doors' in room) {
		for (const [doorId, door] of Object.entries(room.doors)) {
			var args = {
				tempDoorId: 0,
				doorId: doorId,
				x: door.position.x,
				z: door.position.z,
				rotation: door.rotation,
				open: door.open ? 1 : 0
			};

			updateClient.addDoor(args);			
		}
	}	

	//update / add wall points
	if ('wallPoints' in room) {
		for (const [wallPointId, wallPoint] of Object.entries(room.wallPoints)) {
			var args = {
				tempWallPointId: 0,
				wallPointId: wallPointId,
				wallPointGroupId: wallPoint.wallGroupId,
				x: wallPoint.position.x,
				z: wallPoint.position.z
			};

			updateClient.addWallPoint(args);			
		}
	}	

	map.deferWalls = false;
	rebuildWalls(true);
	
	//place planes
	if ('planes' in room) {
		map.loadItemCount += Object.keys(room.planes).length;
		
		for (const [planeId, plane] of Object.entries(room.planes)) {
			var position = new THREE.Vector2(plane.position.x, plane.position.z);
			
			if ('scale' in plane) {
				var scale = new THREE.Vector2(plane.scale.x, plane.scale.y);
			}
			else {
				var scale = new THREE.Vector2(1, 1);
			}

			if ('rotation' in plane) {
				var rotation = plane.rotation;
			}
			else {
				var rotation = 0;
			}			

			createPlaneImage(plane.image, plane.planeUploadId, position, false, scale, rotation, planeId);
		}
	}

	if ('models' in room) {
		for (var i=0;i<room.models.length;i++) {
			map.models[room.models[i].id] = room.models[i];
		}
	}

	//place tokens
	if ('tokens' in room) {
		map.loadItemCount += Object.keys(room.tokens).length;

		var avatarContainer = document.createElement('div');
		avatarContainer.id = 'avatarContainer';
		root.appendChild(avatarContainer);
		
		var avatarInnerContainer = document.createElement('div');
		avatarInnerContainer.id = 'avatarInnerContainer';
		avatarContainer.appendChild(avatarInnerContainer);
		
		for (const [tokenId, token] of Object.entries(room.tokens)) {
			if (!(token.modelId in map.models)) {
				// NOTE(port): the original asked the server to delete such tokens. Never destroy
				// data because of a client-side lookup problem; just skip it.
				console.warn('token has an unknown model, skipped', tokenId, token.modelId);
				loadStateUpdate();
				continue;
			}

			var pos = {
				x: parseData.float(token.position.x),
				y: parseData.float(token.position.y),
				z: parseData.float(token.position.z)
			};
			
			var scale = new THREE.Vector3(1, 1, 1);
			if ('scale' in token) {
				scale = {
					x: parseData.float(token.scale.x),
					y: parseData.float(token.scale.y),
					z: parseData.float(token.scale.z)
				};
			}			

			var owners = [];
			
			for (var j=0;j<token.owners.length;j++) {
				owners.push(parseData.id(token.owners[j]));
			}

			createToken(pos, scale, parseData.id(token.modelId), false, owners, parseData.id(tokenId), token.settings);
		}

		// Look at our first token, but only when the room is first shown: after a reconnect the
		// player keeps the camera where they left it.
		var tokenKeys = Object.keys(map.objects.tokens);

		if (tokenKeys.length > 0 && roomBuilds === 1) {
			for (var i=0;i<tokenKeys.length;i++) {
				var token = map.objects.tokens[tokenKeys[i]];

				if (isDM || checkTokenOwner(token)) {
					lookAtObject(token);
					break;
				}
			}
		}
	}

	//focus camera if set
	var focusKeys = Object.keys(focus);

	if (focusKeys.length > 0) {
		focus.roomId = connection.roomId;
		updateClient.focusCamera(focus);
		focus = {};
	}

	//if nothing to load
	if (map.loadItemCount === 0) {
		loadStateUpdate();
	}
}

function saveSettings() {
	localStorage.setItem('settings', JSON.stringify(map.settings));
}

function loadSettings() {
	if (localStorage.getItem('settings') != null) {
		var settings = JSON.parse(localStorage.getItem('settings'));

		for (const [name, setting] of Object.entries(settings)) {
			if (name in map.settings) {
				map.settings[name] = setting;
			}
		}
	}
}

function addAvatar(token, owner = true) {
	if (!owner) {
		token.avatar = null;
		return;
	}
	
	if (token.avatar != null) { return; }
	
	var avatarInnerContainer = byId('avatarInnerContainer');
	
	if (avatarInnerContainer != null) {
		var avatar = document.createElement('div');
		avatar.className = 'avatar';
		var avatarModel = map.models[token.modelId];
		var borderColor = '#' + ('000000' + (avatarModel.baseColor).toString(16)).slice(-6);
		avatar.style.borderColor = borderColor;
		(function() {
			avatar.addEventListener('click', function() {
				lookAtObject(token);
			}, false);
		}());

		if (avatarModel.src) {
			var avatarImage = document.createElement('img');
			avatarImage.src = options.imageUrl({ kind: 'model', src: avatarModel.src, size: 128, quality: 80 });
			avatar.appendChild(avatarImage);
		}
		else {
			// tokens without an image show their colour
			avatar.style.backgroundColor = borderColor;
		}

		avatarInnerContainer.appendChild(avatar);
		token.avatar = avatar;
	}
}

function removeAvatar(token) {
	if (token.avatar != null) {
		token.avatar.parentNode.removeChild(token.avatar);
		token.avatar = null;
	}
}


//connection to the server (or the offline demo). All protocol translation lives in connection.ts:
//it hands us the same "update" / "request" calls the original server protocol produced.
var banner = createBanner(root);

var connection = createConnection(options, {
	reset: function() { resetRoom(); },
	update: function(name, args) {
		if (name in updateClient) {
			updateClient[name](args);
		}
	},
	request: function(name, args) {
		if (name in clientRequest) {
			clientRequest[name](args);
		}
	},
	status: function(status) { banner.update(status); },
	notify: notify
});

function sendMessage(type, name, args) {
	connection.send(type, name, args);
}

// Handlers for messages coming from the server. connection.ts delivers every message in this
// shape (the original protocol's names and argument names), whatever the wire format is.
var updateClient = {
	
	reportError: function(args) {
		console.warn(args);

		args = validateArguments(args, {
			error: 'text'
		});

		if (args !== false) {
			notify(args.error, 'error');
		}
		else {
			notify('Unknown error occurred', 'error');
		}
	},

	// NOTE(port): new. The connection layer resolves token models (options.resolveModel, or a
	// built-in default) and defines them here before any message that uses them.
	defineModel: function(args) {
		args = validateArguments(args, {
			modelId: 'id',
			name: 'text',
			src: 'text',
			textureRepeatX: 'float',
			textureRepeatY: 'float',
			textureOffsetX: 'float',
			textureOffsetY: 'float',
			size: 'float',
			scale: 'float',
			modelOffsetX: 'float',
			modelOffsetY: 'float',
			viewDistance: 'int',
			baseColor: 'int'
		});

		if (args !== false) {
			map.models[args.modelId] = modelFromArgs(args);
		}
	},

	addToken: function(args) {
		var tempTokenId = args.tempTokenId;
		var owners = Array.isArray(args.owners) ? args.owners.map(parseData.id) : [];
		var settings = args.settings || {};
		var tokenScale = args.scale ? args.scale : { x: 1, y: 1, z: 1 };

		args = validateArguments(args, {
			x: 'float',
			y: 'float',
			z: 'float',
			modelId: 'id',
			tokenId: 'id'
		});

		if (args !== false) {
			if (tempTokenId !== undefined && tempTokenId !== null && String(tempTokenId) in map.objects.tokens) {
				// our own token, now numbered by the server
				renameObjectKey(map.objects.tokens, String(tempTokenId), args.tokenId);
				map.objects.tokens[args.tokenId].tokenId = args.tokenId;
			}
			else if (args.tokenId in map.objects.tokens) {
				// already known (e.g. a repeated message): never create it twice
			}
			else {
				createToken({ x: args.x, y: args.y, z: args.z }, tokenScale, args.modelId, false, owners, args.tokenId, settings);

				updateTokenVision();
			}
		}
	},

	removeToken: function(args) {
		args = validateArguments(args, {
			tokenId: 'id'
		});

		if (args !== false) {
			if (args.tokenId in map.objects.tokens) {
				var token = map.objects.tokens[args.tokenId];

				removeAvatar(token);
				forgetObject(map.translateControls.token, token, [token.base]);

				map.scene.remove(token);
				delete map.objects.tokens[args.tokenId];

				if (chooseOwnVisionToken()) {
					updateVisionMeshes();
					updateTokenVision();
				}
			}
		}
	},

	editModel: function(args) {
		args = validateArguments(args, {
			modelId: 'id',
			name: 'text',
			src: 'text',
			textureRepeatX: 'float',
			textureRepeatY: 'float',
			textureOffsetX: 'float',
			textureOffsetY: 'float',
			size: 'float',
			scale: 'float',
			modelOffsetX: 'float',
			modelOffsetY: 'float',
			viewDistance: 'int',
			baseColor: 'int'
		});

		if (args !== false) {
			if (args.modelId in map.models) {
				var model = modelFromArgs(args);

				map.models[model.modelId] = model;

				for (const [tokenId, token] of Object.entries(map.objects.tokens)) {
					if (token.modelId == model.modelId) {
						map.menuTarget = token;
						makeTokenInstance(token, map.models[model.modelId]);
					}
				}
			}
		}
	},
	
	updateTokenPosition: function(args) {
		args = validateArguments(args, {
			tokenId: 'id',
			x: 'float',
			y: 'float',
			z: 'float'
		});
		
		if (args !== false) {
			if (args.tokenId in map.objects.tokens) {
				var token = map.objects.tokens[args.tokenId];				

				token.position.set(args.x, args.y, args.z);
				token.prevPos.set(args.x, args.y, args.z);

				updateTokenPlaceHolder(token);
				updateVisionMeshes();
				updateTokenVision();
			}
		}
	},
	
	updateTokenScale: function(args) {
		args = validateArguments(args, {
			tokenId: 'id',
			x: 'float',
			y: 'float',
			z: 'float'
		});
		
		if (args !== false && args.tokenId in map.objects.tokens) {
			var token = map.objects.tokens[args.tokenId];
			token.scale.set(args.x, args.y, args.z);

			tokenScaleReposition(token);
		}
	},
	
	updateTokenModel: function(args) {
		args = validateArguments(args, {
			tokenId: 'id',
			modelId: 'id'
		});
		
		if (args !== false && args.tokenId in map.objects.tokens && args.modelId in map.models) {
			var token = map.objects.tokens[args.tokenId];

			//update model if changed
			if (token.modelId != args.modelId) {
				token.modelId = args.modelId;
				makeTokenInstance(token, map.models[args.modelId]);
			}
		}
	},

	// NOTE(port): new. Protocol v2 broadcasts settings changes (the original did not).
	updateTokenSettings: function(args) {
		args = validateArguments(args, {
			tokenId: 'id',
			hideAvatar: 'int',
			disableCamLook: 'int'
		});

		if (args !== false && args.tokenId in map.objects.tokens) {
			var token = map.objects.tokens[args.tokenId];

			token.settings.hideAvatar = args.hideAvatar ? 1 : 0;
			token.settings.disableCamLook = args.disableCamLook ? 1 : 0;

			if (token.avatar) {
				token.avatar.classList[token.settings.hideAvatar ? 'add' : 'remove']('avatar-hidden');
			}

			if (token.settings.disableCamLook) {
				token.rotation.y = 0;
			}
		}
	},

	assignToken: function(args) {
		var owners = Array.isArray(args.owners) ? args.owners.map(parseData.id) : null;

		args = validateArguments(args, {
			tokenId: 'id',
			user_id: 'id'
		});
		
		if (args !== false && args.tokenId in map.objects.tokens) {
			var token = map.objects.tokens[args.tokenId];

			// NOTE(port): the server sends the full owner list; the original only knew "one owner".
			token.owners = owners !== null ? owners : [args.user_id];

			if (isDM || checkTokenOwner(token)) {
				//add
				addAvatar(token);
			}
			else {
				//remove
				removeAvatar(token);
			}

			// only this token changed (the original rebuilt every token)
			makeTokenInstance(token, map.models[token.modelId]);

			if (chooseOwnVisionToken()) {
				updateVisionMeshes();
				updateTokenVision();
			}
		}
	},
	
	updateDM: function(args) {
		args = validateArguments(args, {
			user_id: 'id'
		});
	  
		if (args !== false) {
			if (args.user_id == user_id) {
				if (!isDM) {
					isDM = true;
					map.mask.mesh.material.opacity = DM_FOG_OPACITY;
					map.local.dmLight = 1;

					for (const [tokenId, token] of Object.entries(map.objects.tokens)) {
						token.visible = true;

						if (!token.settings.hideAvatar) {
							addAvatar(token);
						}
					}

					updateGuiItems(isDM);
					notify('You are now a host.');
				}
			}
			else if (args.user_id in map.users) {
				notify(map.users[args.user_id].name + ' is now a host.');
			}
		}
	},

	updateDaylight: function(args) {
		args = validateArguments(args, {
			daylight: 'int'
		});

		if (args !== false) {
			map.local.daylight = args.daylight;
			map.objects.light.intensity = lightLevel(map.local.daylight ? 1.1 : 0.9);

			updateTokenVision();
		}
	},

	updateMoonlight: function(args) {
		args = validateArguments(args, {
			moonlight: 'int'
		});

		if (args !== false) {
			map.local.moonlight = args.moonlight;

			if (map.local.moonlight) {
				map.objects.light.intensity = lightLevel(0.8);
				map.objects.light.color.setHex(0x8cb9ff);
				map.skybox.material = map.skybox.nightMats;
			}
			else {
				map.objects.light.intensity = lightLevel(1);
				map.objects.light.color.setHex(0xffffff);
				map.skybox.material = map.skybox.dayMats;
			}
		}
	},
	
	addPlane: function(args) {
		var tempPlaneId = args.tempPlaneId;

		args = validateArguments(args, {
			x: 'float',
			z: 'float',
			image: 'text',
			planeId: 'id',
			planeUploadId: 'id'
		});
		
		if (args !== false) {
			if (tempPlaneId !== undefined && tempPlaneId !== null && String(tempPlaneId) in map.objects.planes) {
				renameObjectKey(map.objects.planes, String(tempPlaneId), args.planeId);
				map.objects.planes[args.planeId].planeId = args.planeId;
			}
			else if (args.planeId in map.objects.planes) {
				// already known: never create it twice
			}
			else {
				var position = new THREE.Vector2(args.x, args.z);
				createPlaneImage(args.image, args.planeUploadId, position, false, new THREE.Vector2(1, 1), 0, args.planeId);
			}
		}
	},
	
	removePlane: function(args) {
		args = validateArguments(args, {
			planeId: 'id'
		});
		
		if (args !== false) {
			if (args.planeId in map.objects.planes) {
				map.scaleControls.plane.detach();
				map.rotationControls.plane.detach();
				forgetObject(map.translateControls.plane, map.objects.planes[args.planeId], [map.objects.planes[args.planeId]]);
				map.scene.remove(map.objects.planes[args.planeId]);
				delete map.objects.planes[args.planeId];
			}
		}
	},
	
	updatePlaneTransform: function(args) {
		args = validateArguments(args, {
			planeId: 'id',
			posX: 'float',
			posZ: 'float',
			scaleX: 'float',
			scaleY: 'float',
			rotZ: 'float'
		});
		
		if (args !== false) {
			if (args.planeId in map.objects.planes) {
				var plane = map.objects.planes[args.planeId];
				
				plane.position.x = args.posX;
				plane.position.z = args.posZ;
				
				plane.scale.x = args.scaleX;
				plane.scale.y = args.scaleY;
				
				plane.rotation.z = args.rotZ;
			}
		}
	},

	addDoor: function(args) {
		var tempDoorId = args.tempDoorId;

		args = validateArguments(args, {
			doorId: 'id',
			x: 'float',
			z: 'float',
			rotation: 'float',
			open: 'int'
		});

		if (args !== false) {
			if (tempDoorId !== undefined && tempDoorId !== null && String(tempDoorId) in map.objects.doors) {
				renameObjectKey(map.objects.doors, String(tempDoorId), args.doorId);
				map.objects.doors[args.doorId].doorId = args.doorId;
			}
			else if (args.doorId in map.objects.doors) {
				// already known: never create it twice
			}
			else {
				var pos = new THREE.Vector3(args.x, 0, args.z);
				addDoor(false, args.doorId, pos, args.rotation, args.open, false);
			}
		}
	},

	removeDoor: function(args) {
		args = validateArguments(args, {
			doorId: 'id'
		});

		if (args !== false) {
			map.rotationControls.door.detach();
			removeDoor(args.doorId, false);
		}
	},

	updateDoorTransform: function(args) {
		args = validateArguments(args, {
			doorId: 'id',			
			x: 'float',
			z: 'float',
			rotation: 'float'
		});

		if (args !== false) {
			if (args.doorId in map.objects.doors) {
				map.objects.doors[args.doorId].position.x = args.x;
				map.objects.doors[args.doorId].position.z = args.z;
				map.objects.doors[args.doorId].rotation.y = args.rotation;

				rebuildWalls();
				updateTokenVision();				
			}
		}
	},

	updateDoorState: function(args) {
		args = validateArguments(args, {
			doorId: 'id',			
			open: 'int'
		});

		if (args !== false) {
			if (args.doorId in map.objects.doors && map.objects.doors[args.doorId].open != args.open) {
				doorClick(map.objects.doors[args.doorId], false);

				updateTokenVision();				
			}
		}
	},
	
  addWallPoint: function(args) {
		var tempWallPointId = args.tempWallPointId;

		args = validateArguments(args, {
			wallPointId: 'id',
			wallPointGroupId: 'id',
			x: 'float',
			z: 'float'
		});

		if (args !== false) {
			var group = map.wallPointGroups[args.wallPointGroupId];

			if (group && tempWallPointId !== undefined && tempWallPointId !== null && String(tempWallPointId) in group.points) {
				renameObjectKey(group.points, String(tempWallPointId), args.wallPointId);
				group.points[args.wallPointId].wallPointId = args.wallPointId;
			}
			else if (group && args.wallPointId in group.points) {
				// already known: never create it twice
			}
			else {
				var pos = new THREE.Vector3(args.x, 0, args.z);
				addWallPoint(false, args.wallPointId, args.wallPointGroupId, pos, false);
			}
		}
	},

	// NOTE(port): protocol v2 identifies a wall point by its id alone, so the group is looked up.
	removeWallPoint: function(args) {
		args = validateArguments(args, {
			wallPointGroupId: 'id?',
			wallPointId: 'id'
		});

		if (args !== false) {
			var groupId = args.wallPointGroupId !== undefined ? args.wallPointGroupId : findWallPointGroupId(args.wallPointId);

			if (groupId !== null) {
				removeWallPoint(groupId, args.wallPointId, false);

				updateVisionMeshes();
				updateTokenVision();
			}
		}
	},

	updateWallPoint: function(args) {
		args = validateArguments(args, {
			wallPointGroupId: 'id?',
			wallPointId: 'id',
			x: 'float',
			z: 'float'
		});

		if (args !== false) {
			var groupId = args.wallPointGroupId !== undefined ? args.wallPointGroupId : findWallPointGroupId(args.wallPointId);

			if (groupId !== null && args.wallPointId in map.wallPointGroups[groupId].points) {
				map.wallPointGroups[groupId].points[args.wallPointId].position.x = args.x;
				map.wallPointGroups[groupId].points[args.wallPointId].position.z = args.z;

				updateWallGroup(map.wallPointGroups[groupId]);
				updateVisionMeshes();
				updateTokenVision();
			}
		}
	},

	userJoined: function(args) {
		// NOTE(port): the room used to arrive as a JSON string; the connection layer now passes an object.
		var room = typeof args.room === 'string' ? JSON.parse(args.room) : args.room;

		args = validateArguments(args, {
			user_id: 'id',
			name: 'text',
			picture: 'text'
		});

		if (args !== false) {
			user_id = args.user_id;

			buildRoom(room);

			// NOTE(port): the side buttons and panes are created once; rebuilding the room after a
			// reconnect must not add them a second time.
			if (!guiBuilt) {
				guiBuilt = true;
				buildGui();
			}

			updateGuiItems(isDM);

			updateClient.clientConnected({
				user_id: user_id,
				name: args.name,
				picture: args.picture
			});
		}
	},
		
	clientConnected: function(args) {
		args = validateArguments(args, {
			user_id: 'id',
			name: 'text',
			picture: 'text'
		});

		if (args !== false) {
			var userContainer = byId('user-' + args.user_id);

			if (userContainer == null) {
				//check if user is in map object and add if missing
				if (args.user_id in map.users) {
					var user = map.users[args.user_id];
					user.live = true;
				}
				else {
					var user = {						
						color: rainbow(10, Object.keys(map.users).length),
						connections: [],
						live: true,
						name: args.name,
						picture: args.picture
					};

					map.users[args.user_id] = user;
				}
						
				userContainer = document.createElement('div');
				userContainer.id = 'user-' + args.user_id;
				userContainer.classList.add('user-container');
				userContainer.classList.add('user-section-item');
				userContainer.classList.add('noselect');

				userContainer.addEventListener("pointerdown", canvasCheck, false);
				userContainer.addEventListener("pointermove", canvasMove, false);
				userContainer.addEventListener("pointerup", canvasClick, false);

				var userImage = document.createElement('div');
				userImage.classList.add('user-image');
				userImage.classList.add('user-section-item');
				userImage.classList.add('noselect');
				userImage.style.backgroundImage = 'url("' + String(user.picture).replace(/["\\\n]/g, '') + '")';
				userImage.style.border = '2px solid #' + user.color;
				userContainer.appendChild(userImage);

				var userName = document.createElement('div');
				userName.classList.add('user-name');
				userName.classList.add('user-section-item');
				userName.classList.add('noselect');
				userName.textContent = user.name;
				userContainer.appendChild(userName);

				var userSection = byId('user-section');

				if (userSection != null) {
					userSection.appendChild(userContainer);
				}
			}
		}
	},

	clientDisconnected: function(args) {
		args = validateArguments(args, {
			user_id: 'id'
		});

		if (args !== false) {
			if (args.user_id in map.users) {
				map.users[args.user_id].live = false;

				var userContainer = byId('user-' + args.user_id);

				if (userContainer != null) {
					userContainer.parentNode.removeChild(userContainer);	
				}
			}
		}
	},
		
	ping: function(args) {
		args = validateArguments(args, {
			x: 'float',
			z: 'float',
			user_id: 'id'
		});
		
		if (args !== false) {
			var position = { x: args.x, z: args.z };
			var color = 0x0886c4;

			if (args.user_id in map.users) {
				color = '0x' + map.users[args.user_id].color;					
			}

			map.ping(null, color, position, false);
		}
	},
	
	// Moves the camera to where the host is looking. Not part of the core server: it only works
	// when the host app implements "focusCamera" (see the README).
	focusCamera: function(args) {
		args = validateArguments(args, {
			roomId: 'id?',
			xpos: 'float',
			ypos: 'float',
			zpos: 'float',
			xtarget: 'float',
			ytarget: 'float',
			ztarget: 'float'
		});
		
		if (args !== false) {
			if (args.roomId !== undefined && args.roomId != connection.roomId) {
				changeRoom(args.roomId, args);
			}
			else {
				map.orbitControls.animating = true;
				map.objects.camera.newPosition = new THREE.Vector3(args.xpos, args.ypos, args.zpos);
				map.orbitControls.newTarget = new THREE.Vector3(args.xtarget, args.ytarget, args.ztarget);
			}
		}
	},

	updateGridSize: function(args) {
		args = validateArguments(args, {
	  		width: 'int',
	  		height: 'int'
	  	});

		if (args !== false) {
			map.settings.gridWidth = args.width;
			map.settings.gridHeight = args.height;
			updateGridSize(false);
		}
	}
}

var guiBuilt = false;

// Model objects are stored in the shape the rest of the client uses.
function modelFromArgs(args) {
	return {
		id: args.modelId,
		modelId: args.modelId,
		name: args.name,
		src: args.src,
		textureRepeat: [args.textureRepeatX, args.textureRepeatY],
		textureOffset: [args.textureOffsetX, args.textureOffsetY],
		size: args.size,
		scale: args.scale,
		modelOffset: [args.modelOffsetX, args.modelOffsetY],
		viewDistance: args.viewDistance,
		baseColor: args.baseColor
	};
}

function findWallPointGroupId(wallPointId) {
	for (const [groupId, group] of Object.entries(map.wallPointGroups)) {
		if (wallPointId in group.points) {
			return groupId;
		}
	}

	return null;
}

// Stops a removed object from being picked or hovered (the original left dead objects in these lists).
function forgetObject(controls, object, hoverTargets = []) {
	var index = controls.translateObjects.indexOf(object);

	if (index > -1) {
		controls.translateObjects.splice(index, 1);
	}

	for (const target of hoverTargets) {
		var hoverIndex = map.hover.targets.indexOf(target);

		if (hoverIndex > -1) {
			map.hover.targets.splice(hoverIndex, 1);
		}
	}

	if (controls.object === object) {
		controls.object = null;
	}
}

function copyInviteLink() {
	var inviteLink = options.inviteLink(map.inviteCode);

	if (navigator.clipboard && navigator.clipboard.writeText) {
		navigator.clipboard.writeText(inviteLink).then(function() {
			notify('Invite link copied to clipboard.');
		}, function() {
			notify('Invite link: ' + inviteLink);
		});
	}
	else {
		notify('Invite link: ' + inviteLink);
	}
}

var clientRequest = {
	
	// Host-app feature: the server answers with an invite code (see the README).
	refreshInviteCode: function(args) {
		args = validateArguments(args, {
			inviteCode: 'text'
		});

		if (args !== false) {
			map.inviteCode = args.inviteCode;

			if (options.inviteLink) {
				copyInviteLink();
			}
		}
	},

	getModel: function(args) {
		args = validateArguments(args, {
			modelId: 'id',
			name: 'text',
			src: 'text',
			textureRepeatX: 'float',
			textureRepeatY: 'float',
			textureOffsetX: 'float',
			textureOffsetY: 'float',
			size: 'float',
			scale: 'float',
			modelOffsetX: 'float',
			modelOffsetY: 'float',
			viewDistance: 'int',
			baseColor: 'int'
		});

		if (args !== false) {
			var model = modelFromArgs(args);

			map.models[model.modelId] = model;
			chooseTokenModel(model.modelId);
		}
	},

	getModels: function(args) {
		//remove old items
		map.panes.tokens.body.innerHTML = '';

		//new token button
		// NOTE(port): uploading tokens needs the host app's uploadModel() hook.
		var newTokenButton = buildPaneItem(map.panes.tokens, '', 'button', '+ New Token');
		newTokenButton.element.querySelector('.pane-item-label-text').style.display = 'none';
		if (!options.uploadModel) { newTokenButton.element.style.display = 'none'; }

		newTokenButton.input.addEventListener('click', function() {
			closePane(map.panes.tokens);

			map.local.tokenFormData.name.value = map.local.tokenFormDefault.name;
			map.local.tokenFormData.id.value = '';
			map.local.tokenFormData.src.value = '';
			map.local.tokenFormData.textureRepeatX.value = map.local.tokenFormDefault.textureRepeatX;
			map.local.tokenFormData.textureRepeatY.value = map.local.tokenFormDefault.textureRepeatY;
			map.local.tokenFormData.textureOffsetX.value = map.local.tokenFormDefault.textureOffsetX;
			map.local.tokenFormData.textureOffsetY.value = map.local.tokenFormDefault.textureOffsetY;
			map.local.tokenFormData.size.value = map.local.tokenFormDefault.size;
			map.local.tokenFormData.scale.value = map.local.tokenFormDefault.scale;
			map.local.tokenFormData.modelOffsetX.value = map.local.tokenFormDefault.modelOffsetX;
			map.local.tokenFormData.modelOffsetY.value = map.local.tokenFormDefault.modelOffsetY;
			map.local.tokenFormData.viewDistance.value = map.local.tokenFormDefault.viewDistance;
			map.local.tokenFormData.baseColor.value = map.local.tokenFormDefault.baseColor;

			var fileLabel = map.local.tokenFormData.file.element.querySelector('.pane-item-label-text');
			fileLabel.innerHTML = 'Image File';

			var tokenFile = byId('token_file');

			if (tokenFile != null) {
				tokenFile.value = '';
			}

			openPane(map.panes.new_token);
		}, false);

		if ('folders' in args) {
			for (var j=0;j<args.folders.length;j++) {
				var folder = buildPaneItem(map.panes.tokens, escapeHtml(args.folders[j].name), 'folder', args.folders[j].image);

				(function() {
					var pane = map.panes.tokens;
					var folderId = args.folders[j].folderId;
					var parentId = args.folders[j].parentId;
					
					folder.element.addEventListener('click', function() {															

						var args = {
							parentId: parentId,
							folderId: folderId,
							limit: map.local.tokenListLimit,
							offset: map.local.tokenListOffset
						};

						sendMessage('request', 'getModels', args);
					});
				}());
			}
		}

		if ('models' in args) {
			//build image items
			for (var j=0;j<args.models.length;j++) {
				var model = args.models[j];

				// models without an image (built-in defaults) show a colour swatch
				var thumbPath = model.src ? options.imageUrl({ kind: 'model', src: model.src, size: 200, quality: 80 }) : swatchUrl(model.baseColor);
			
				var image = buildPaneItem(map.panes.tokens, escapeHtml(model.name), 'image', thumbPath);
				
				if (model.ownerId !== undefined && String(model.ownerId) !== '0') {
					image.input.deleteButton.style.display = 'block';
					(function() {
						var modelId = model.modelId;
						var imageElem = image;

						image.input.deleteButton.addEventListener('click', function() {
							var result = window.confirm('This token will be removed from all maps. Are you sure you want to delete it? ');
							
							if (result) {
								imageElem.element.parentNode.removeChild(imageElem.element);

								var args = {
									modelId: modelId
								};

								sendMessage('request', 'deleteModel', args);
							}
						}, false);
					}());
				}

				(function() {
					var pane = map.panes.tokens;
					var modelId = model.modelId;
					
					image.input.image.addEventListener('click', function() {
						getModel(modelId);
						closePane(pane);
					}, false);
				}());
			}
		}

		if ('folders' in args && 'models') {
			var paginaiton = buildPaneItem(map.panes.tokens, '', 'pagination');
			paginaiton.input.up.style.display = 'none';
			paginaiton.input.next.style.display = 'none';
			paginaiton.input.prev.style.display = 'none';

			//up button
			// NOTE(port): folder ids are opaque strings too (UUIDs); the top level is 0, '0' or empty.
			if (isFolderId(args.folderId)) {
				paginaiton.input.up.style.display = 'block';
				paginaiton.input.up.addEventListener('click', function() {
					changeTokenPage(args.parentId, args.parentId, 0);
				}, false);
			}

			//next button
			if ((args.folders.length > 0 || args.models.length > 0) && 'showNext' in args && args.showNext) {
				paginaiton.input.next.style.display = 'inline-block';
				paginaiton.input.next.addEventListener('click', function() {
					map.local.tokenListOffset += map.local.tokenListLimit;
					changeTokenPage(args.folderId, args.parentId, map.local.tokenListOffset);
				}, false);
			}
			
			//prev button
			if (map.local.tokenListOffset > 0) {
				paginaiton.input.prev.style.display = 'inline-block';
				paginaiton.input.prev.addEventListener('click', function() {
					map.local.tokenListOffset -= map.local.tokenListLimit;
					changeTokenPage(args.folderId, args.parentId, map.local.tokenListOffset);
				}, false);
			}
		}

		hideContextMenu();
		openPane(map.panes.tokens);
		map.panes.tokens.element.scrollTop = 0;
	},

	getPlaneImages:	function(args) {
		//get plane images pane
		//remove old items
		map.panes.plane_images.body.innerHTML = '';

		//new plane button
		var newPlaneButton = buildPaneItem(map.panes.plane_images, '', 'button', '+ New Plane');
		newPlaneButton.element.querySelector('.pane-item-label-text').style.display = 'none';
		if (!options.uploadPlane) { newPlaneButton.element.style.display = 'none'; }

		newPlaneButton.input.addEventListener('click', function() {
			closePane(map.panes.plane_images);

			var planeFile = byId('plane_file');

			if (planeFile != null) {
				planeFile.value = '';
			}

			map.local.planeFormData.name.value = '';

			openPane(map.panes.new_plane_image);					
		}, false);

		// NOTE(port): without an image library on the server, images can be added by URL.
		if (args.allowUrl) {
			var urlItem = buildPaneItem(map.panes.plane_images, 'Image URL', 'text-input', '');
			var urlButton = buildPaneItem(map.panes.plane_images, '', 'button', 'Add image from URL');
			urlButton.element.querySelector('.pane-item-label-text').style.display = 'none';

			urlButton.input.addEventListener('click', function() {
				var url = urlItem.input.value.trim();

				if (url === '') { return; }

				if (url.length > 256) {
					notify('That URL is too long (256 characters at most).', 'error');
					return;
				}

				var position = map.lastClickPos ? new THREE.Vector2(map.lastClickPos[0].point.x, map.lastClickPos[0].point.z) : new THREE.Vector2(0, 0);
				createPlaneImage(url, 'url', position);
				closePane(map.panes.plane_images);
			}, false);
		}

		if ('folders' in args) {
			//build folder items
			for (var j=0;j<args.folders.length;j++) {
				var folder = buildPaneItem(map.panes.plane_images, escapeHtml(args.folders[j].name), 'folder', args.folders[j].image);

				(function() {
					var pane = map.panes.plane_images;
					var folderId = args.folders[j].folderId;
					var parentId = args.folders[j].parentId;
					
					folder.element.addEventListener('click', function() {															

						var args = {
							parentId: parentId,
							folderId: folderId,
							limit: map.local.tokenListLimit,
							offset: map.local.tokenListOffset
						};

						sendMessage('request', 'getPlaneImages', args);
					});
				}());
			}
		}

		if ('planes' in args) {
			//build image items
			for (var j=0;j<args.planes.length;j++) {
				var src = parseData.id(args.planes[j].src);
				var name = escapeHtml(args.planes[j].name);
				var planeUploadId = parseData.id(args.planes[j].planeUploadId);

				var thumbPath = options.imageUrl({ kind: 'plane', src: src, size: 200, quality: 80 });
				
				var image = buildPaneItem(map.panes.plane_images, name, 'image', thumbPath);
				
				if (args.planes[j].ownerId !== undefined && String(args.planes[j].ownerId) !== '0') {
					image.input.deleteButton.style.display = 'block';
					(function() {
						var puid = planeUploadId;
						var imageElem = image;

						image.input.deleteButton.addEventListener('click', function() {
							var result = window.confirm('This image will be deleted from all maps. Are you sure you want to delete it?');
							
							if (result) {
								imageElem.element.parentNode.removeChild(imageElem.element);

								var args = {
									planeUploadId: puid
								};

								sendMessage('request', 'deletePlaneUpload', args);
							}
						}, false);
					}());
				}

				(function() {
					var pane = map.panes.plane_images;
					var file = src;
					var puid = planeUploadId;
					
					image.input.image.addEventListener('click', function() {
						var position = new THREE.Vector2(map.lastClickPos[0].point.x, map.lastClickPos[0].point.z);
						createPlaneImage(file, puid, position);
						closePane(pane);
					});
				}());
			}
		}

		if ('folders' in args && 'planes') {
			var paginaiton = buildPaneItem(map.panes.plane_images, '', 'pagination');
			paginaiton.input.up.style.display = 'none';
			paginaiton.input.next.style.display = 'none';
			paginaiton.input.prev.style.display = 'none';

			//up button
			// NOTE(port): folder ids are opaque strings too (UUIDs); the top level is 0, '0' or empty.
			if (isFolderId(args.folderId)) {
				paginaiton.input.up.style.display = 'block';
				paginaiton.input.up.addEventListener('click', function() {
					changePlanePage(args.parentId, args.parentParentId, 0);
				}, false);
			}

			//next button
			if ((args.folders.length > 0 || args.planes.length > 0) && 'showNext' in args && args.showNext) {
				paginaiton.input.next.style.display = 'inline-block';
				paginaiton.input.next.addEventListener('click', function() {
					map.local.planeListOffset += map.local.planeListLimit;
					changePlanePage(args.folderId, args.parentId, map.local.planeListOffset);
				}, false);
			}
			
			//prev button
			if (map.local.planeListOffset > 0) {
				paginaiton.input.prev.style.display = 'inline-block';
				paginaiton.input.prev.addEventListener('click', function() {
					map.local.planeListOffset -= map.local.planeListLimit;
					changePlanePage(args.folderId, args.parentId, map.local.planeListOffset);
				}, false);
			}
		}
		
		hideContextMenu();
		openPane(map.panes.plane_images);
	},

	getRooms: function(args) {
		if ('rooms' in args) {
			//get rooms pane
			//remove old items
			map.panes.rooms.body.innerHTML = '';

			//new room button
			var newRoomButton = buildPaneItem(map.panes.rooms, '', 'button', '+ New Room');
			newRoomButton.element.querySelector('.pane-item-label-text').style.display = 'none';

			newRoomButton.input.addEventListener('click', function() {
				closePane(map.panes.rooms);

				//set room name input to blank
				map.local.roomFormData.name.value = "";
				openPane(map.panes.new_room);				
			}, false);

			//build room image items
			for (var j=0;j<args.rooms.length;j++) {
				var room = args.rooms[j];
				var name = escapeHtml(room.name);
				var thumbPath = swatchUrl(0x3c7d65);
				var image = buildPaneItem(map.panes.rooms, name, 'image', thumbPath);

				(function() {
					var roomId = room.room_id;

					image.input.image.addEventListener('click', function() {
						changeRoom(roomId);
					}, false);

					image.input.deleteButton.style.display = 'block';
					image.input.deleteButton.addEventListener('click', function() {
						var result = window.confirm('Are you sure you want to delete this room?');
						
						if (result) {
							var args = {
								roomId: roomId
							};

							sendMessage('request', 'deleteRoom', args);
						}
					}, false);
				}());
			}
			
			hideContextMenu();
			openPane(map.panes.rooms);
			map.panes.rooms.element.scrollTop = 0;
		}
	},

	deleteModel: function(args) {
		if (args !== false) {
			for (var i=0;i<args.tokens.length;i++) {
				var tokenId = parseData.id(args.tokens[i]);
				updateClient.removeToken({ tokenId: tokenId });
			}
		}
	},

	deletePlaneUpload: function(args) {
		if (args !== false) {
			for (var i=0;i<args.planes.length;i++) {
				var planeId = parseData.id(args.planes[i]);
				updateClient.removePlane({ planeId: planeId });
			}
		}
	}
}

function mobileAndTabletCheck() {
  // Touch-first devices get the lighter graphics preset by default.
  return !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
}

function validateArguments(args, types) {
	var output = {};

	for (var type in types) {
		if (types.hasOwnProperty(type)) {
			// NOTE(port): a trailing "?" marks an optional argument.
			var optional = types[type].endsWith('?');
			var parser = parseData[optional ? types[type].slice(0, -1) : types[type]];

			if (args && type in args && args[type] !== undefined && args[type] !== null) {
				output[type] = parser(args[type]);
			}
			else if (optional) {
				continue;
			}
			else {
				console.warn('missing argument:', parseData.string(type));
				return false;
			}
		}
	}
	
	return output;
}

function renameObjectKey(o, old_key, new_key) {
	if (old_key !== new_key) {
	    Object.defineProperty(o, new_key,
	        Object.getOwnPropertyDescriptor(o, old_key));
	    delete o[old_key];
	}
}

function defaultContextMenu(e) {
	if (typeof(e.touches) == "undefined") {
		e.preventDefault();
	}
}

function rainbow(numOfSteps, step) {
    var r, g, b;
    var h = step / numOfSteps;
    var i = ~~(h * 6);
    var f = h * 6 - i;
    var q = 1 - f;
    switch(i % 6){
        case 0: r = 1; g = f; b = 0; break;
        case 1: r = q; g = 1; b = 0; break;
        case 2: r = 0; g = 1; b = f; break;
        case 3: r = 0; g = q; b = 1; break;
        case 4: r = f; g = 0; b = 1; break;
        case 5: r = 1; g = 0; b = q; break;
    }
    var c = ("00" + (~ ~(r * 255)).toString(16)).slice(-2) + ("00" + (~ ~(g * 255)).toString(16)).slice(-2) + ("00" + (~ ~(b * 255)).toString(16)).slice(-2);
    return (c);
}

function openContextMenu(e, menu) {
	hideContextMenu();

	if (typeof(menu) != "undefined") {
		e.preventDefault();

		menu.show(e.clientX, e.clientY);
	}
}

// NOTE(port): registered once (the original added a new pair of listeners on every menu opening
// and its removeEventListener calls could never match them).
listen(document, 'click', function(e) { hideContextMenu(e); }, false);
listen(document, 'touchstart', function(e) { hideContextMenu(e); }, false);

function hideContextMenu(e = false){

	if (e && e.target && e.target.classList && e.target.classList.contains('context-menu-element')) { return; };
	
	// hide menus
	for (var menu in map.menus) {
		if (map.menus.hasOwnProperty(menu)) {
			map.menus[menu].hide();
		}
	}
}

var compass = document.createElement('div');
compass.id = 'compass';
root.appendChild(compass);
var dir = new THREE.Vector3();
var sph = new THREE.Spherical();

var destroyed = false;
var animationFrame = 0;
var resizeObserver = { disconnect: function() {} };

function animate() {
	if (destroyed) { return; }
	
	if (map.orbitControls.animating) {
		var delta = clock.getDelta();
		var speed = 2;
		map.objects.camera.position.lerp(map.objects.camera.newPosition, delta * speed);
		map.orbitControls.target.lerp(map.orbitControls.newTarget, delta * speed);
	}
	
	map.orbitControls.update();
	map.mask.fog.update(performance.now());
	
	if (map.settings.lookAtCam) {
		for (const [tokenId, token] of Object.entries(map.objects.tokens)) {
			if (token.settings.disableCamLook) { continue; }
			token.lookAt(map.objects.camera.position.x, token.position.y, map.objects.camera.position.z);
		}
	}

	map.objects.camera.getWorldDirection(dir);
  sph.setFromVector3(dir);
  compass.style.transform = `rotate(${THREE.MathUtils.radToDeg(sph.theta) - 180}deg)`;

	if (destroyed) { return; }

	animationFrame = requestAnimationFrame(animate);
	render();
}

function render() {
	var delta = clock.getDelta();

	if (mixer) {
		mixer.update( delta );
	}

	//map.renderer.render( map.scene, map.objects.camera );
	map.composer.render();
}

function loadStateUpdate() {
	if (map.loadItemCount != null) {
		if (!map.loaded) {
			map.loadItemCount--;

			if (map.loadItemCount < 1) {
				hideLoadScreen();
			}
		}
	}
	else {
		hideLoadScreen();
	}
}


//hides loadscreen after 10 seconds
var loadTimeout = setTimeout(function() {
	if (!map.loaded) {
		console.warn('load screen timeout');
		hideLoadScreen();
	}
}, 10000);

function hideLoadScreen() {
	map.loaded = true;

	//wait additional half second for rendering
	setTimeout(function() {
		if (destroyed) { return; }

		map.loadScreen.style.opacity = '0';
		map.loadScreen.style.pointerEvents = 'none';

		setTimeout(function() {
			if (destroyed) { return; }

			map.loadScreen.style.display = 'none';
			chooseOwnVisionToken();
			updateVisionMeshes();
			updateTokenVision();
		},500);
	}, 500);
}

// ---- start ----

map.loadScreen = document.createElement('div');
map.loadScreen.id = 'load-screen';
map.loadScreen.innerHTML = '<div id="load-text">Tabletop</div><div class="load-spinner"></div>';
root.appendChild(map.loadScreen);

init();
animate();
connection.connect();

// ---- public handle ----

return {
	// Removes everything the viewer added to the page and closes the connection.
	destroy: function() {
		destroyed = true;
		cancelAnimationFrame(animationFrame);
		clearTimeout(loadTimeout);
		connection.close();
		cleanups.forEach(function(cleanup) { cleanup(); });
		resizeObserver.disconnect();
		map.orbitControls.stopListenToKeyEvents();
		map.orbitControls.dispose();
		map.selectionHelper.dispose();
		resetRoom();
		map.composer.dispose();
		map.mask.fog.dispose();
		if (wallMaterial) {
			if (wallMaterial.map) { wallMaterial.map.dispose(); }
			wallMaterial.dispose();
		}
		map.renderer.dispose();
		root.remove();
	},
	// Counts of what is currently in the scene (used by tests, handy when debugging).
	getSceneStats: function() {
		var wallPoints = 0;

		for (const group of Object.values(map.wallPointGroups)) {
			wallPoints += Object.keys(group.points).length;
		}

		return {
			tokens: Object.keys(map.objects.tokens).length,
			planes: Object.keys(map.objects.planes).length,
			doors: Object.keys(map.objects.doors).length,
			wallPoints: wallPoints,
			wallGroups: Object.keys(map.wallPointGroups).length,
			users: Object.keys(map.users).length,
			isHost: isDM,
			userId: user_id,
			tokenIds: Object.keys(map.objects.tokens),
			status: connection.status
		};
	},
	getTokenPosition: function(tokenId) {
		var token = map.objects.tokens[tokenId];
		return token ? { x: token.position.x, y: token.position.y, z: token.position.z } : null;
	},
	// Where a token's base is on screen, in page coordinates (used by tests to drag it).
	getTokenScreenPosition: function(tokenId) {
		var token = map.objects.tokens[tokenId];
		// a token the player cannot see (outside the vision of the selected token) has no position
		if (!token || !token.visible) { return null; }

		var point = new THREE.Vector3(token.position.x, token.position.y - 0.45, token.position.z).project(map.objects.camera);
		var rect = map.canvas.getBoundingClientRect();

		return { x: rect.left + ((point.x + 1) / 2) * rect.width, y: rect.top + ((1 - point.y) / 2) * rect.height };
	},
	// Only available with options.debug: the internal state object.
	debug: options.debug ? { map: map, connection: connection, updateClient: updateClient } : undefined
};
}
