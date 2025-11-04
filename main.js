import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js";

let scene, camera, renderer, clock;
let cloudMaterial, rainGroup;
let mouse = new THREE.Vector2(0, 0);
let isMouseDown = false;
let windVector = new THREE.Vector2(0, 0);
let temperatureField = 0.5;
let timeOfDay = 0.0; // 0–1 range
let sunLight, ambientLight;

const canvas = document.getElementById("weatherCanvas");
init();
animate();

function init() {
  scene = new THREE.Scene();

  // Camera
  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, 0, 5);

  // Renderer
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;

  clock = new THREE.Clock();

  // Lighting
  ambientLight = new THREE.AmbientLight(0x555577, 0.4);
  scene.add(ambientLight);

  sunLight = new THREE.DirectionalLight(0xffffff, 2.0);
  sunLight.position.set(5, 3, 2);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  scene.add(sunLight);

  // Cloud Shader Material
  const cloudGeo = new THREE.PlaneGeometry(10, 10, 1, 1);
  const uniforms = {
    iTime: { value: 0 },
    iResolution: { value: new THREE.Vector3(window.innerWidth, window.innerHeight, 1) },
    sunDirection: { value: sunLight.position.clone().normalize() },
    temperature: { value: temperatureField },
    humidity: { value: 0.5 },
    dayPhase: { value: timeOfDay }
  };

  const vertShader = await (await fetch("./shader.vert")).text();
  const fragShader = await (await fetch("./shader.frag")).text();

  cloudMaterial = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: vertShader,
    fragmentShader: fragShader,
    transparent: true,
    depthWrite: false
  });

  const cloudMesh = new THREE.Mesh(cloudGeo, cloudMaterial);
  scene.add(cloudMesh);

  // Rain system
  rainGroup = new THREE.Group();
  createRainParticles();
  scene.add(rainGroup);

  // Events
  window.addEventListener("resize", onWindowResize);
  window.addEventListener("mousedown", () => (isMouseDown = true));
  window.addEventListener("mouseup", () => (isMouseDown = false));
  window.addEventListener("mousemove", onMouseMove);
}

function createRainParticles() {
  const geometry = new THREE.BufferGeometry();
  const count = 10000;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 10;
    positions[i * 3 + 1] = Math.random() * 10;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 10;
  }
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: 0x88aaff,
    size: 0.02,
    transparent: true,
    opacity: 0.6,
    depthWrite: false
  });
  const rain = new THREE.Points(geometry, material);
  rainGroup.add(rain);
}

function onMouseMove(event) {
  const x = (event.clientX / window.innerWidth) * 2 - 1;
  const y = -(event.clientY / window.innerHeight) * 2 + 1;
  if (isMouseDown) {
    windVector.x += x * 0.01;
    windVector.y += y * 0.01;
    temperatureField += 0.005;
  }
  mouse.set(x, y);
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  cloudMaterial.uniforms.iResolution.value.set(window.innerWidth, window.innerHeight, 1);
}

function updateRain(delta) {
  rainGroup.children.forEach(points => {
    const pos = points.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      pos.array[i * 3 + 1] -= 5.0 * delta; // gravity
      if (pos.array[i * 3 + 1] < -5) pos.array[i * 3 + 1] = 5;
      pos.array[i * 3] += windVector.x * delta * 50.0;
      pos.array[i * 3 + 2] += windVector.y * delta * 50.0;
    }
    pos.needsUpdate = true;
  });
}

function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();
  const elapsed = clock.getElapsedTime();

  // Day/night cycle
  timeOfDay = (elapsed * 0.02) % 1.0;
  const sunAngle = timeOfDay * Math.PI * 2;
  sunLight.position.set(Math.cos(sunAngle) * 5, Math.sin(sunAngle) * 5, 2);
  sunLight.intensity = Math.max(0.2, Math.sin(sunAngle) * 1.5);
  ambientLight.intensity = 0.2 + Math.max(0, Math.sin(sunAngle)) * 0.3;

  // Update temperature & humidity cycle
  const humidity = 0.5 + 0.5 * Math.sin(elapsed * 0.05);
  temperatureField = Math.max(0.2, Math.min(1.2, temperatureField - humidity * 0.001));

  // Pass to shader
  cloudMaterial.uniforms.iTime.value = elapsed;
  cloudMaterial.uniforms.sunDirection.value.copy(sunLight.position.clone().normalize());
  cloudMaterial.uniforms.temperature.value = temperatureField;
  cloudMaterial.uniforms.humidity.value = humidity;
  cloudMaterial.uniforms.dayPhase.value = timeOfDay;

  // Update rain
  updateRain(delta);

  renderer.render(scene, camera);
}
