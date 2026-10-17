import * as THREE from "three";
import { createResearchNetwork } from "./research-network.js";
import { createFrameProfiler } from "./frame-profiler.js";
import { stepZoom, zoomGesture } from "./zoom-motion.js";
import { types } from "./sources.js";
import { createPinLayer } from "./pin-layer.js";
import { createMapContext } from "./map-context.js";
import { createImageryLayer } from "./imagery-layer.js";
import {
  geoVector,
  vectorGeo,
  nextZoom,
  circlePositions,
  EARTH_KM,
  MIN_ALTITUDE,
} from "./geo.js";

export async function createGlobe(container, overlay, callbacks) {
  const profile = createFrameProfiler(
    process.env.NODE_ENV === "development" &&
      new URLSearchParams(location.search).has("profileMap"),
  );
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  container.append(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.000001, 100);
  const earth = new THREE.Group();
  scene.add(earth);
  earth.rotation.set(0.34, 0.45, -0.08);
  const loader = new THREE.TextureLoader();
  const loaded = await Promise.allSettled(
    [
      "earth-day.jpg",
      "earth-normal.jpg",
      "earth-specular.jpg",
      "earth-clouds.png",
    ].map((file) => loader.loadAsync(`/textures/${file}`)),
  );
  if (loaded.some((result) => result.status === "rejected")) {
    for (const result of loaded)
      if (result.status === "fulfilled") result.value.dispose();
    renderer.dispose();
    renderer.domElement.remove();
    throw new Error("Earth textures could not load");
  }
  const [day, normal, specular, cloudMap] = loaded.map(
    (result) => result.value,
  );
  day.colorSpace = THREE.SRGBColorSpace;
  cloudMap.colorSpace = THREE.SRGBColorSpace;
  [day, normal, specular, cloudMap].forEach((texture) => {
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  });
  const geometry = new THREE.SphereGeometry(1, 256, 128);
  const surface = new THREE.Mesh(
    geometry,
    new THREE.MeshPhongMaterial({
      map: day,
      normalMap: normal,
      normalScale: new THREE.Vector2(0.5, 0.5),
      specularMap: specular,
      specular: new THREE.Color("#263947"),
      shininess: 32,
    }),
  );
  earth.add(surface);
  const clouds = new THREE.Mesh(
    new THREE.SphereGeometry(1.006, 96, 64),
    new THREE.MeshPhongMaterial({
      map: cloudMap,
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
      side: THREE.FrontSide,
    }),
  );
  earth.add(clouds);
  scene.add(new THREE.AmbientLight("#6d8fb9", 0.54));
  const sun = new THREE.DirectionalLight("#e5f0ff", 3.0);
  sun.position.set(-3.5, 3, 5);
  scene.add(sun);
  const fill = new THREE.DirectionalLight("#375f9b", 0.25);
  fill.position.set(3, 0, -2);
  scene.add(fill);
  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(1.025, 96, 64),
    new THREE.ShaderMaterial({
      vertexShader:
        "varying vec3 vNormal; varying vec3 vPosition; void main(){vNormal=normalize(normalMatrix*normal); vec4 p=modelViewMatrix*vec4(position,1.0);vPosition=p.xyz;gl_Position=projectionMatrix*p;}",
      fragmentShader:
        "varying vec3 vNormal; varying vec3 vPosition; void main(){float rim=pow(1.0-abs(dot(normalize(vNormal),normalize(-vPosition))),4.5);gl_FragColor=vec4(0.22,0.51,1.0,rim*0.65);}",
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  earth.add(atmosphere);
  // A static star field is inexpensive and does not compete with the data layer.
  let seed = 73;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const starPositions = [],
    starColors = [];
  for (let i = 0; i < 1700; i++) {
    starPositions.push(
      (random() - 0.5) * 60,
      (random() - 0.5) * 45,
      -8 - random() * 25,
    );
    const light = 0.18 + random() * 0.55;
    starColors.push(light * 0.85, light * 0.91, light);
  }
  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(starPositions, 3),
  );
  starGeometry.setAttribute(
    "color",
    new THREE.Float32BufferAttribute(starColors, 3),
  );
  scene.add(
    new THREE.Points(
      starGeometry,
      new THREE.PointsMaterial({
        size: 0.027,
        vertexColors: true,
        transparent: true,
        opacity: 0.72,
        sizeAttenuation: true,
        depthWrite: false,
      }),
    ),
  );
  const circleGeometry = new THREE.BufferGeometry();
  const marker = new THREE.Line(
    circleGeometry,
    new THREE.LineBasicMaterial({
      color: "#e4edfb",
      transparent: true,
      opacity: 1,
      depthTest: true,
      depthWrite: false,
    }),
  );
  marker.visible = false;
  marker.renderOrder = 100;
  earth.add(marker);
  const circleFill = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshBasicMaterial({
      color: "#b7d4ff",
      transparent: true,
      opacity: 0.08,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  circleFill.visible = false;
  circleFill.renderOrder = 99;
  earth.add(circleFill);
  const records = [];
  const research = createResearchNetwork({
    earth,
    camera,
    container: container.parentElement,
    records,
    reducedMotion,
  });
  const pins = createPinLayer({
    canvas: overlay,
    camera,
    earth,
    records,
    types,
    reducedMotion,
  });
  const imagery = createImageryLayer(
    earth,
    camera,
    (visible) => callbacks.imagery?.(visible),
    {
      pixelRatio: renderer.getPixelRatio(),
      anisotropy: Math.min(8, renderer.capabilities.getMaxAnisotropy()),
    },
  );
  const mapContext = createMapContext({
    earth,
    camera,
    overlay,
    obstacles: () => pins.labelObstacles(),
    onStatus: (visible) => callbacks.reference?.(visible),
  });
  let width = 1,
    height = 1,
    fullDistance = 3.25,
    zoomDistance = 3.25,
    progress = 0,
    shownProgress = 0,
    targetQuaternion = null,
    focusFlight = false;
  let pointer = null,
    moved = 0,
    previousTime = 0,
    frame = 0,
    selectedLocation = null,
    manualRadius = null,
    lastCircleRadius = 0,
    paused = false;
  let zoomMotion = { logAltitude: Math.log(2.03 - 1), velocity: 0 };
  const resize = () => {
    width = container.clientWidth;
    height = container.clientHeight;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    pins.resize(width, height, Math.min(devicePixelRatio, 2));
    mapContext.resize(width, height, Math.min(devicePixelRatio, 2));
    const previousFullDistance = fullDistance;
    fullDistance = Math.max(
      3.25,
      1.12 / (Math.sin(Math.PI / 9) * camera.aspect),
    );
    zoomDistance =
      1 +
      THREE.MathUtils.clamp(
        ((zoomDistance - 1) * (fullDistance - 1)) / (previousFullDistance - 1),
        MIN_ALTITUDE,
        fullDistance * 1.15 - 1,
      );
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();
  const raycaster = new THREE.Raycaster(),
    mouse = new THREE.Vector2(),
    sphere = new THREE.Sphere(),
    intersection = new THREE.Vector3();
  function surfacePoint(x, y) {
    mouse.set((x / width) * 2 - 1, (-y / height) * 2 + 1);
    raycaster.setFromCamera(mouse, camera);
    sphere.center.copy(earth.position);
    sphere.radius = 1;
    return raycaster.ray.intersectSphere(sphere, intersection)
      ? earth.worldToLocal(intersection.clone()).normalize()
      : null;
  }
  function automaticRadius(point, x, y) {
    const normal = geoVector(point.lat, point.lon),
      distances = [];
    for (const [dx, dy] of [
      [56, 0],
      [-56, 0],
      [0, 56],
      [0, -56],
    ]) {
      const edge = surfacePoint(x + dx, y + dy);
      if (!edge) continue;
      distances.push(
        Math.atan2(
          new THREE.Vector3().crossVectors(normal, edge).length(),
          normal.dot(edge),
        ) * EARTH_KM,
      );
    }
    const fallback =
      (((camera.position.distanceTo(earth.position) - 1) *
        2 *
        Math.tan(Math.PI / 9) *
        56) /
        height) *
      EARTH_KM;
    return THREE.MathUtils.clamp(
      distances.length
        ? distances.reduce((a, b) => a + b, 0) / distances.length
        : fallback,
      0.05,
      1500,
    );
  }
  function screenPoint(point) {
    const world = geoVector(point.lat, point.lon)
      .applyQuaternion(earth.quaternion)
      .add(earth.position);
    const projected = world.clone().project(camera);
    return {
      x: (projected.x * 0.5 + 0.5) * width,
      y: (-0.5 * projected.y + 0.5) * height,
    };
  }
  function pick(x, y) {
    const pin = pins.hitTest(x, y);
    if (pin)
      return { ...pin.point, name: pin.point.locationName, x: pin.x, y: pin.y };
    const point = surfacePoint(x, y);
    return point ? { ...vectorGeo(point), x, y } : null;
  }
  function select(point) {
    selectedLocation = { ...point };
    manualRadius = 0.8;
    lastCircleRadius = 0;
    const screen = screenPoint(point),
      radiusKm = automaticRadius(point, screen.x, screen.y);
    marker.visible = true;
    circleFill.visible = true;
    callbacks.select({ ...point, ...screen, radiusKm });
  }
  function updateSelection() {
    if (!selectedLocation) return;
    const screen = screenPoint(selectedLocation),
      radiusKm =
        manualRadius ?? automaticRadius(selectedLocation, screen.x, screen.y);
    if (
      lastCircleRadius === 0 ||
      Math.abs(radiusKm - lastCircleRadius) / lastCircleRadius > 0.005
    ) {
      const positions = circlePositions(
        selectedLocation.lat,
        selectedLocation.lon,
        radiusKm,
      );
      circleGeometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(positions, 3),
      );
      circleGeometry.computeBoundingSphere();
      const normal = geoVector(
          selectedLocation.lat,
          selectedLocation.lon,
        ).multiplyScalar(1.000006),
        fan = [normal.x, normal.y, normal.z, ...positions],
        indices = [];
      for (let i = 1; i < positions.length / 3; i++) indices.push(0, i, i + 1);
      circleFill.geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(fan, 3),
      );
      circleFill.geometry.setIndex(indices);
      circleFill.geometry.computeBoundingSphere();
      lastCircleRadius = radiusKm;
    }
    callbacks.selectionUpdate?.({ ...screen, radiusKm });
  }
  const canvas = renderer.domElement;
  canvas.addEventListener("pointerdown", (event) => {
    if (progress < 0.8 || event.button !== 0) return;
    profile?.begin();
    pointer = {
      id: event.pointerId,
      lastX: event.clientX,
      lastY: event.clientY,
    };
    moved = 0;
    targetQuaternion = null;
    focusFlight = false;
    canvas.setPointerCapture(event.pointerId);
    container.classList.add("dragging");
  });
  canvas.addEventListener("pointermove", (event) => {
    const rect = canvas.getBoundingClientRect(),
      x = event.clientX - rect.left,
      y = event.clientY - rect.top;
    if (pointer && pointer.id === event.pointerId) {
      const dx = event.clientX - pointer.lastX,
        dy = event.clientY - pointer.lastY;
      moved += Math.abs(dx) + Math.abs(dy);
      if (moved > 5) {
        const radiansPerPixel =
          ((camera.position.z - 1) * 2 * Math.tan(Math.PI / 9)) / height;
        earth.rotation.y +=
          (dx * radiansPerPixel) / Math.max(0.2, Math.cos(earth.rotation.x));
        earth.rotation.x = THREE.MathUtils.clamp(
          earth.rotation.x + dy * radiansPerPixel,
          -1.48,
          1.48,
        );
        callbacks.move();
      }
      pointer.lastX = event.clientX;
      pointer.lastY = event.clientY;
      return;
    }
    const pin = progress > 0.8 ? pins.hitTest(x, y) : null;
    canvas.style.cursor = pin ? "pointer" : progress > 0.8 ? "grab" : "default";
    callbacks.hover(
      pin
        ? {
            x: pin.x,
            y: pin.y,
            text: `${pin.point.locationName || "Location"} · ${pin.count} records`,
          }
        : null,
    );
  });
  canvas.addEventListener("pointerup", (event) => {
    if (!pointer || pointer.id !== event.pointerId) return;
    const rect = canvas.getBoundingClientRect();
    if (moved < 6) {
      const point = pick(event.clientX - rect.left, event.clientY - rect.top);
      if (point) select(point);
    }
    pointer = null;
    container.classList.remove("dragging");
    profile?.report();
  });
  canvas.addEventListener("pointercancel", () => {
    pointer = null;
    container.classList.remove("dragging");
  });
  canvas.addEventListener("pointerleave", () => callbacks.hover(null));
  function zoom(delta) {
    zoomDistance = nextZoom(zoomDistance, delta, fullDistance * 1.15);
    if (selectedLocation)
      targetQuaternion = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(
          (selectedLocation.lat * Math.PI) / 180,
          -Math.PI / 2 - (selectedLocation.lon * Math.PI) / 180,
          0,
        ),
      );
    callbacks.hover(null);
  }
  canvas.addEventListener(
    "wheel",
    (event) => {
      if (progress < 0.99) return;
      if (
        event.deltaY < 0 &&
        zoomDistance >= fullDistance - 0.02 &&
        !event.ctrlKey
      )
        return;
      event.preventDefault();
      zoom(zoomGesture(event.deltaY, event.deltaMode, height, event.ctrlKey));
    },
    { passive: false },
  );
  function render(now) {
    frame = requestAnimationFrame(render);
    if (reducedMotion && previousTime && now - previousTime < 50) return;
    const dt = Math.min(0.25, (now - previousTime) / 1000 || 0.016);
    previousTime = now;
    if (document.hidden || paused) return;
    shownProgress = reducedMotion
      ? progress
      : THREE.MathUtils.damp(shownProgress, progress, 7, dt);
    const t = shownProgress * shownProgress * (3 - 2 * shownProgress);
    earth.position.y = THREE.MathUtils.lerp(-1.16, 0, t);
    let desiredAltitude = THREE.MathUtils.lerp(1.03, zoomDistance - 1, t);
    // Stay above the surface while travelling to a place on the other side.
    if (focusFlight && targetQuaternion) {
      const angle = earth.quaternion.angleTo(targetQuaternion);
      desiredAltitude = Math.max(
        desiredAltitude,
        1.2 * Math.sin(angle / 2) ** 2,
      );
      if (angle < 0.002) focusFlight = false;
    }
    zoomMotion = stepZoom(zoomMotion, desiredAltitude, dt, reducedMotion);
    camera.position.z = 1 + Math.exp(zoomMotion.logAltitude);
    if (targetQuaternion) {
      earth.quaternion.slerp(
        targetQuaternion,
        reducedMotion ? 1 : 1 - Math.exp(-5 * dt),
      );
      if (earth.quaternion.angleTo(targetQuaternion) < 0.00000001)
        targetQuaternion = null;
    }
    if (shownProgress < 0.25 && !reducedMotion) earth.rotation.y += dt * 0.018;
    const altitude = camera.position.distanceTo(earth.position) - 1;
    const near = Math.max(0.000001, Math.min(0.1, altitude * 0.05));
    if (Math.abs(camera.near - near) / near > 0.02) {
      camera.near = near;
      camera.updateProjectionMatrix();
    }
    clouds.material.opacity =
      0.62 * THREE.MathUtils.smoothstep(altitude, 0.015, 0.08);
    clouds.rotation.y += reducedMotion ? 0 : dt * 0.003;
    earth.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
    const frameStart = profile ? performance.now() : 0;
    imagery.update(now, width, height, dt);
    const imageEnd = profile ? performance.now() : 0;
    mapContext.update(now, dt, shownProgress);
    const contextEnd = profile ? performance.now() : 0;
    updateSelection();
    callbacks.scale?.(
      (((camera.position.z - 1) * 2 * Math.tan(Math.PI / 9) * 100) / height) *
        EARTH_KM,
    );
    renderer.render(scene, camera);
    const renderEnd = profile ? performance.now() : 0;
    pins.update(dt, shownProgress);
    research.update(now, dt, width, height);
    if (profile)
      profile.sample({
        frameMs: dt * 1000,
        imageryMs: imageEnd - frameStart,
        labelsMs: contextEnd - imageEnd,
        renderMs: renderEnd - contextEnd,
        pinsMs: performance.now() - renderEnd,
      });
  }
  camera.position.z = 2.03;
  render(0);
  return {
    startResearch(point) {
      research.start(point);
    },
    stopResearch() {
      research.stop();
    },
    setPaused(value) {
      paused = value;
    },
    setRecords(value) {
      pins.setRecords(value);
      research.setRecords(value);
    },
    setProgress(value) {
      progress = value;
    },
    filter(value) {
      pins.filter(value);
    },
    zoom,
    focus(place, { radiusKm, selectPoint = true } = {}) {
      focusFlight = true;
      targetQuaternion = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(
          (place.lat * Math.PI) / 180,
          -Math.PI / 2 - (place.lon * Math.PI) / 180,
          0,
        ),
      );
      zoomDistance = Number.isFinite(radiusKm)
        ? 1 +
          THREE.MathUtils.clamp(
            (radiusKm * height) / (2 * Math.tan(Math.PI / 9) * 56 * EARTH_KM),
            MIN_ALTITUDE,
            fullDistance - 1,
          )
        : Math.min(zoomDistance, 1.035);
      if (selectPoint) select({ ...place, x: width * 0.5, y: height * 0.5 });
      else {
        selectedLocation = { ...place };
        marker.visible = true;
        circleFill.visible = true;
      }
      if (Number.isFinite(radiusKm)) {
        manualRadius = radiusKm;
        lastCircleRadius = 0;
      }
      return THREE.MathUtils.clamp(
        (((zoomDistance - 1) * 2 * Math.tan(Math.PI / 9) * 56) / height) *
          EARTH_KM,
        0.05,
        1500,
      );
    },
    setRegionRadius(value) {
      manualRadius = value;
      lastCircleRadius = 0;
    },
    reset() {
      focusFlight = false;
      targetQuaternion = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(0.34, 0.45, -0.08),
      );
      zoomDistance = fullDistance;
      callbacks.move();
    },
    clearSelection() {
      selectedLocation = null;
      marker.visible = false;
      circleFill.visible = false;
    },
    dispose() {
      cancelAnimationFrame(frame);
      observer.disconnect();
      research.dispose();
      pins.dispose();
      imagery.dispose();
      mapContext.dispose();
      renderer.dispose();
      circleGeometry.dispose();
      circleFill.geometry.dispose();
      geometry.dispose();
      scene.traverse((object) => {
        object.geometry?.dispose();
        const materials = Array.isArray(object.material)
          ? object.material
          : [object.material];
        for (const material of materials) material?.dispose();
      });
      renderer.domElement.remove();
      [day, normal, specular, cloudMap].forEach((texture) => texture.dispose());
    },
  };
}
