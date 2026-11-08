import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createShadows, MAP_SIZE } from './shadows.js';

// Shadows for the High graphics setting (shadows.js): off costs nothing, on casts from tokens and
// from host-app casters, and redraws only when something moved.

function setup() {
  const scene = new THREE.Scene();
  const renderer = { shadowMap: { enabled: false, autoUpdate: true, needsUpdate: false, type: 0 } };
  const shadows = createShadows(scene, renderer);
  return { scene, renderer, shadows };
}

function token() {
  const group = new THREE.Group();
  group.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial()));
  return group;
}

describe('shadows', () => {
  it('adds nothing to the scene and leaves the renderer alone until switched on', () => {
    const { scene, renderer, shadows } = setup();
    expect(scene.children).toHaveLength(0);
    expect(renderer.shadowMap.enabled).toBe(false);
    const t = token();
    scene.add(t);
    shadows.addCaster(t);
    expect((t.children[0] as THREE.Mesh).castShadow).toBe(false);
    expect(shadows.fit(new THREE.Vector3(), -0.53, 20)).toBe(false);
    expect(shadows.update()).toBe(false);
  });

  it('switched on: a light that lights nothing, a catcher above the floor, casting tokens', () => {
    const { scene, renderer, shadows } = setup();
    const t = token();
    scene.add(t);
    shadows.addCaster(t);
    shadows.setEnabled(true);
    expect(renderer.shadowMap.enabled).toBe(true);
    expect(renderer.shadowMap.autoUpdate).toBe(false);
    expect(shadows.light.intensity).toBe(0);
    expect(shadows.light.castShadow).toBe(true);
    expect(shadows.light.shadow.mapSize.x).toBe(MAP_SIZE);
    expect(scene.children).toContain(shadows.catcher);
    expect((t.children[0] as THREE.Mesh).castShadow).toBe(true);
    shadows.setEnabled(false);
    expect(scene.children).not.toContain(shadows.catcher);
    expect(scene.children).not.toContain(shadows.light);
    expect((t.children[0] as THREE.Mesh).castShadow).toBe(false);
    expect(renderer.shadowMap.enabled).toBe(false);
  });

  it('covers the floor around the view, bounded, above the map pictures', () => {
    const { renderer, shadows } = setup();
    shadows.setEnabled(true);
    renderer.shadowMap.needsUpdate = false;
    expect(shadows.fit(new THREE.Vector3(10, 0, 4), -0.53, 20)).toBe(true);
    expect(renderer.shadowMap.needsUpdate).toBe(true);
    const cam = shadows.light.shadow.camera;
    expect(cam.right).toBe(15);
    expect(shadows.catcher.position.y).toBeGreaterThan(-0.51);
    expect(shadows.light.position.y).toBeGreaterThan(shadows.light.target.position.y);
    // the same view again changes nothing
    renderer.shadowMap.needsUpdate = false;
    expect(shadows.fit(new THREE.Vector3(10, 0, 4), -0.53, 20)).toBe(false);
    expect(renderer.shadowMap.needsUpdate).toBe(false);
    // a huge view is capped; a tiny one has a floor
    shadows.fit(new THREE.Vector3(), -0.53, 10000);
    expect(cam.right).toBe(60);
    shadows.fit(new THREE.Vector3(), -0.53, 0.1);
    expect(cam.right).toBe(4);
  });

  it('lets lit pieces cast, not flat helpers like health bars, and picks up pieces that load later', () => {
    const { scene, shadows } = setup();
    const t = token();
    const bar = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.1), new THREE.MeshBasicMaterial());
    t.add(bar);
    scene.add(t);
    shadows.addCaster(t);
    shadows.setEnabled(true);
    expect((t.children[0] as THREE.Mesh).castShadow).toBe(true);
    expect(bar.castShadow).toBe(false);
    const picture = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshPhongMaterial());
    t.add(picture);
    expect(shadows.update()).toBe(true);
    expect(picture.castShadow).toBe(true);
  });

  it('forgets casters taken off the map, and redraws when touched', () => {
    const { scene, renderer, shadows } = setup();
    const t = token();
    scene.add(t);
    shadows.addCaster(t);
    shadows.setEnabled(true);
    shadows.update();
    scene.remove(t);
    expect(shadows.update()).toBe(true);
    renderer.shadowMap.needsUpdate = false;
    expect(shadows.update()).toBe(false);
    shadows.touch();
    expect(shadows.update()).toBe(true);
  });

  it('redraws only when a caster moved', () => {
    const { scene, renderer, shadows } = setup();
    const t = token();
    scene.add(t);
    shadows.addCaster(t);
    shadows.setEnabled(true);
    shadows.update();
    renderer.shadowMap.needsUpdate = false;
    expect(shadows.update()).toBe(false);
    t.position.x = 3;
    expect(shadows.update()).toBe(true);
    expect(renderer.shadowMap.needsUpdate).toBe(true);
  });

  it('gives a host app invisible casters it moves and removes', () => {
    const { scene, shadows } = setup();
    shadows.setEnabled(true);
    const before = scene.children.length;
    const caster = shadows.createCaster([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const mesh = scene.children[scene.children.length - 1] as THREE.Mesh;
    expect(scene.children.length).toBe(before + 1);
    expect(mesh.castShadow).toBe(true);
    // it writes nothing to the picture, but three.js draws it into the shadow map: that pass tests
    // the main camera's layers, so it must stay on the main camera's layer
    const material = mesh.material as THREE.MeshBasicMaterial;
    expect(material.colorWrite).toBe(false);
    expect(material.depthWrite).toBe(false);
    expect(mesh.layers.test(new THREE.Camera().layers)).toBe(true);
    caster.set([1, 2, 3], [0, 0, 0, 1], 0.5);
    expect(mesh.position.toArray()).toEqual([1, 2, 3]);
    expect(mesh.scale.x).toBe(0.5);
    caster.remove();
    expect(scene.children.length).toBe(before);
  });

  it('fades at night', () => {
    const { shadows } = setup();
    shadows.setStrength(0.5);
    expect((shadows.catcher.material as THREE.ShadowMaterial).opacity).toBeCloseTo(0.16, 5);
  });
});
