// Mouse / touch input. Two interaction modes:
//   - Orbit: right-mouse drag (or two-finger drag) rotates the camera around
//     the tower; wheel zooms.
//   - Block placement: left-click on a card-target block to pick it up.
//     The block then follows the cursor in the plane perpendicular to the
//     camera until the next click drops it.

import * as THREE from "three";

export interface OrbitState {
  azimuth: number;
  elevation: number;
  distance: number;
  target: THREE.Vector3;
}

export interface InputHandles {
  raycaster: THREE.Raycaster;
  pointer: THREE.Vector2;
  orbit: OrbitState;
  isPointerDown: boolean;
  lastIntersectedBlockId: number | null;
  installListeners(canvas: HTMLCanvasElement): void;
  updateCamera(camera: THREE.PerspectiveCamera): void;
  pointerOnHeightPlane(camera: THREE.PerspectiveCamera, y: number, out: THREE.Vector3): boolean;
  intersectMeshes(camera: THREE.PerspectiveCamera, meshes: THREE.Mesh[]): { mesh: THREE.Mesh; point: THREE.Vector3 } | null;
}

type Listener = {
  pickRequested?: (blockId: number, point: THREE.Vector3) => void;
  dropRequested?: () => void;
  rotateBlock?: (delta: number) => void;
};

export function createInput(listener: Listener): InputHandles {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const orbit: OrbitState = {
    azimuth: Math.PI / 4,
    elevation: Math.PI / 5,
    distance: 7.5,
    target: new THREE.Vector3(0, 1.2, 0),
  };
  let isPointerDown = false;
  let lastIntersectedBlockId: number | null = null;

  function setPointer(e: PointerEvent, canvas: HTMLCanvasElement) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  function installListeners(canvas: HTMLCanvasElement) {
    let lastX = 0, lastY = 0;
    let orbiting = false;

    canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    canvas.addEventListener("pointerdown", (e) => {
      canvas.setPointerCapture(e.pointerId);
      isPointerDown = true;
      lastX = e.clientX; lastY = e.clientY;
      setPointer(e, canvas);
      if (e.button === 2 || e.shiftKey) {
        orbiting = true;
        return;
      }
      // Left click — interpret as pick/drop in game-loop's hover state.
      if (e.button === 0) {
        if (lastIntersectedBlockId !== null && listener.pickRequested) {
          // We can't raycast here without camera; main loop tracks intersect.
          listener.pickRequested(lastIntersectedBlockId, new THREE.Vector3());
        } else if (listener.dropRequested) {
          listener.dropRequested();
        }
      }
    });

    canvas.addEventListener("pointermove", (e) => {
      setPointer(e, canvas);
      if (!isPointerDown) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      if (orbiting) {
        orbit.azimuth -= dx * 0.008;
        orbit.elevation = clamp(orbit.elevation - dy * 0.006, 0.08, Math.PI / 2 - 0.05);
      }
    });

    const endPointer = (e: PointerEvent) => {
      isPointerDown = false;
      orbiting = false;
      canvas.releasePointerCapture(e.pointerId);
    };
    canvas.addEventListener("pointerup", endPointer);
    canvas.addEventListener("pointercancel", endPointer);

    canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      orbit.distance = clamp(orbit.distance + e.deltaY * 0.005, 3, 16);
    }, { passive: false });

    window.addEventListener("keydown", (e) => {
      if (e.key === "q" || e.key === "Q") listener.rotateBlock?.(-Math.PI / 12);
      else if (e.key === "e" || e.key === "E") listener.rotateBlock?.(+Math.PI / 12);
    });
  }

  function updateCamera(camera: THREE.PerspectiveCamera) {
    const x = orbit.target.x + orbit.distance * Math.cos(orbit.elevation) * Math.sin(orbit.azimuth);
    const z = orbit.target.z + orbit.distance * Math.cos(orbit.elevation) * Math.cos(orbit.azimuth);
    const y = orbit.target.y + orbit.distance * Math.sin(orbit.elevation);
    camera.position.set(x, y, z);
    camera.lookAt(orbit.target);
  }

  function pointerOnHeightPlane(camera: THREE.PerspectiveCamera, y: number, out: THREE.Vector3): boolean {
    raycaster.setFromCamera(pointer, camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -y);
    const hit = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(plane, hit)) {
      out.copy(hit);
      return true;
    }
    return false;
  }

  function intersectMeshes(camera: THREE.PerspectiveCamera, meshes: THREE.Mesh[]) {
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(meshes, false);
    if (hits.length === 0) {
      lastIntersectedBlockId = null;
      return null;
    }
    const hit = hits[0];
    lastIntersectedBlockId = (hit.object.userData.blockId ?? null) as number | null;
    return { mesh: hit.object as THREE.Mesh, point: hit.point };
  }

  return {
    raycaster,
    pointer,
    orbit,
    get isPointerDown() { return isPointerDown; },
    get lastIntersectedBlockId() { return lastIntersectedBlockId; },
    installListeners,
    updateCamera,
    pointerOnHeightPlane,
    intersectMeshes,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
