import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'https://esm.sh/three@0.160.0';

const VolumetricClouds = () => {
  const canvasRef = useRef(null);
  const [isRunning, setIsRunning] = useState(true);
  const [samples, setSamples] = useState(60); // volumetric samples control
  const [isFullscreen, setIsFullscreen] = useState(false); // fullscreen state
  const [fps, setFps] = useState(0);
  const [gpuLoad, setGpuLoad] = useState(0); // NEW: estimated GPU load %
  // simple in-page code editor state
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorText, setEditorText] = useState('// Inline editor\n// Shader source not available in editor mode\n// Use this area to paste or tweak GLSL snippets for experimentation.');
  const animationRef = useRef(null);
  const timeRef = useRef(0);
  const fpsRef = useRef({ lastT: performance.now(), frames: 0, accum: 0 });

  // NEW: wind UI state
  const [windSpeed, setWindSpeed] = useState(0.25);
  const [windAngle, setWindAngle] = useState(40); // degrees

  // camera state
  const camPos = useRef([0, 0.5, -2.0]);
  const camYaw = useRef(0);
  const camPitch = useRef(0);
  const moveVec = useRef([0, 0, 0]); // x,z movement
  const touchJoystickRef = useRef(null);
  const mouseDownRef = useRef(false);
  const lastMouseRef = useRef([0, 0]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    function resize() {
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      const width = Math.floor(canvas.clientWidth * dpr);
      const height = Math.floor(canvas.clientHeight * dpr);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
    }
    resize();

    const gl = canvas.getContext('webgl2');
    if (!gl) {
      alert('WebGL 2 not supported in this browser.');
      return;
    }

    // Vertex shader
    const vertexShaderSource = `#version 300 es
      in vec4 position;
      void main() {
        gl_Position = position;
      }
    `;

    // Fragment shader with ray marching and camera uniforms + sample count + wind
    // Enhanced lighting: Henyey-Greenstein phase function and a simple multi-scatter approx.
    const fragmentShaderSource = `#version 300 es
      precision highp float;
      
      uniform vec2 resolution;
      uniform float time;
      uniform vec3 camPos;
      uniform vec3 camForward;
      uniform vec3 camRight;
      uniform vec3 camUp;
      uniform vec2 windVec; // UPDATED: full wind vector (x,z)
      uniform int samples;
      uniform float complexity; // NEW: shader complexity multiplier
      // cloud growth control texture/seed (we simulate with time & seed in shader)
      uniform float growthSeed;
      // precipitation control (intensity)
      uniform float precipIntensity;
      // time (seconds) when clouds begin to visibly develop
      uniform float cloudSpawnTime;
      uniform float lightning; // NEW: lightning pulse intensity (0..1)
      out vec4 fragColor;
      
      float hash(vec3 p) {
        p = fract(p * 0.3183099 + 0.1);
        p *= 17.0;
        return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
      }
      float noise(vec3 x) {
        vec3 p = floor(x);
        vec3 f = fract(x);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(mix(hash(p + vec3(0,0,0)), hash(p + vec3(1,0,0)), f.x),
              mix(hash(p + vec3(0,1,0)), hash(p + vec3(1,1,0)), f.x), f.y),
          mix(mix(hash(p + vec3(0,0,1)), hash(p + vec3(1,0,1)), f.x),
              mix(hash(p + vec3(0,1,1)), hash(p + vec3(1,1,1)), f.x), f.y),
          f.z);
      }
      float fbm(vec3 p) {
        float f = 0.0;
        float amp = 0.5;
        for(int i = 0; i < 6; i++) {
          f += amp * noise(p);
          p *= 2.01;
          amp *= 0.5;
        }
        return f;
      }
      // Henyey-Greenstein phase function for anisotropic scattering
      float hgPhase(float cosTheta, float g) {
        float denom = 1.0 + g*g - 2.0*g*cosTheta;
        return (1.0 - g*g) / (4.0 * 3.14159265 * pow(denom, 1.5));
      }
      // cloud structure + growth system: growthSeed nudges base density over time
      float cloudDensity(vec3 p, vec2 wind) {
        // apply wind advection properly (x,z) to make clouds move
        vec3 wind3 = vec3(wind.x * 0.8, 0.0, wind.y * 0.6);
        vec3 q = p + wind3 * time * 0.12 + vec3(growthSeed * 0.5, 0.0, 0.0);
        float base = fbm(q * 0.5);
        float detail = fbm(q * 2.0);
        // structure system: layered ridges + cellular growth factor
        float ridge = smoothstep(0.35, 0.6, base) * (1.0 - pow(abs(fract(q.x*0.3)-0.5)*2.0, 1.5));
        float growth = 0.6 + 0.6 * sin(time * 0.25 + q.x * 0.7 + growthSeed * 3.0);
        float density = (base * 0.8 + detail * 0.25) * (0.6 + 0.6 * ridge) * growth - 0.28;
        // prefer mid-altitude formation: rise then fade near top
        float lowerRamp = smoothstep(0.2, 0.9, p.y);
        float upperFade = 1.0 - smoothstep(1.6, 2.4, p.y);
        float heightFalloff = lowerRamp * upperFade;
        density *= heightFalloff;
        return max(0.0, density);
      }
      // approximate single + multiple scattering combined lighting calculation
      vec3 calculateLighting(vec3 p, float density, vec3 viewDir) {
        vec3 sunDir = normalize(vec3(0.5, 0.8, 0.3));
        // single scattering: sample along light direction coarse
        float lightDensity = 0.0;
        float step = 0.08 * (1.0 + complexity*0.4); // complexity increases lighting samples
        int steps = int(3.0 + complexity*3.0);
        for(int i=0;i<12;i++){
          if(i >= steps) break;
          vec3 lightPos = p + sunDir * float(i) * step;
          lightDensity += cloudDensity(lightPos, vec2(0.1,0.0));
        }
        float trans = exp(-lightDensity * (1.6 + complexity*0.8));
        // phase: forward scattering favored for clouds (g ~ 0.75)
        float g = 0.7 + 0.2 * growthSeed;
        float cosTheta = dot(normalize(sunDir), normalize(viewDir));
        float phase = hgPhase(cosTheta, g) * (1.0 + 0.5 * density); // stronger effect in dense regions

        // ambient + direct
        vec3 ambient = vec3(0.45, 0.55, 0.78) * 0.28;
        vec3 direct = vec3(1.0, 0.95, 0.85) * trans * phase * (1.0 + 0.6 * density);

        // simple multi-scatter approximation (adds soft brightening in deep clouds)
        float multiFactor = smoothstep(0.08, 0.5, density) * (0.25 + 0.5 * complexity);
        vec3 multi = mix(vec3(0.0), vec3(0.95,0.85,0.75) * 0.6, multiFactor);

        return ambient + direct + multi;
      }

      // generate a smoother screen-space streak pattern for rain based on world position & time
      float rainStreak(vec2 uv, float seed, float speed, float intensity) {
        // tile and bias so rain is localized under high cloud pockets (seed)
        uv *= vec2(40.0 + 120.0*intensity, 160.0); // stretch vertically more when intense
        float x = fract(uv.x + seed * 10.0);
        float y = fract(uv.y + time * speed);
        // produce a smoother vertical band using smoothstep for anti-aliasing
        float band = smoothstep(0.52, 0.38, abs(x - 0.5));
        // fade as it falls (gives streak length) with eased curve
        float fade = smoothstep(0.0, 1.0, pow(y, 0.6));
        // apply a subtle noise modulation so lines don't alias into single-pixel artifacts
        float n = noise(vec3(uv * 0.12, seed * 5.0));
        float mod = mix(0.8, 1.25, n) * (0.6 + 0.8 * intensity);
        return band * (1.0 - pow(fade, 1.3)) * mod;
      }

      vec4 raymarch(vec3 ro, vec3 rd, vec2 wind, out float precipOut) {
        vec3 color = vec3(0.0);
        float alpha = 0.0;
        float t = 0.0;
        int s = samples;
        float precipAcc = 0.0;
        // adaptive stepping using samples uniform
        for(int i = 0; i < 300; i++) {
          if(i >= s) break;
          if(alpha > 0.995) break;
          vec3 p = ro + rd * t;
          if(p.y < 0.0 || p.y > 2.4) { t += 0.08; continue; }
          float density = cloudDensity(p, wind);
          // apply spawn gating so clouds are absent before spawn and smoothly appear after
          float spawnFactor = smoothstep(cloudSpawnTime, cloudSpawnTime + 2.0, time);
          density *= spawnFactor;
          if(density > 0.01) {
            // accumulate precipitation potential where density is high
            float localPrecip = max(0.0, (density - 0.22)) * 0.95;
            // weight accumulation by local density to favor deep pockets
            precipAcc += clamp(localPrecip * (1.0 + density*1.5), 0.0, 0.35);
            vec3 lighting = calculateLighting(p, density, rd);
            float deltaAlpha = density * 0.36;
            // intensity scaled by complexity so heavier lighting math darkens/brightens accordingly
            color += lighting * density * (1.0 - alpha) * (0.32 + 0.12 * complexity);
            alpha += deltaAlpha * (1.0 - alpha);
          }
          // make step length slightly adaptive to reduce banding
          t += (0.025 + 0.06 * (1.0 - density)) / (1.0 + 0.15 * complexity);
        }
        precipOut = precipAcc;
        return vec4(color, alpha);
      }
      void main() {
        vec2 uv = (gl_FragCoord.xy - 0.5 * resolution) / resolution.y;
        // build ray from provided camera basis
        vec3 rd = normalize(camForward + uv.x * camRight + uv.y * camUp);
        // sky
        vec3 skyColor = mix(vec3(0.3,0.5,0.9), vec3(0.5,0.7,1.0), smoothstep(-0.5,0.5,rd.y));
        vec3 sunDir = normalize(vec3(0.5, 0.8, 0.3));
        float sun = pow(max(0.0, dot(rd, sunDir)), 128.0);
        skyColor += vec3(1.0,0.9,0.7) * sun * (0.6 + 0.8 * complexity);

        // small wind vector (use both components for x/z)
        vec2 wind = windVec;
        float precipLocal = 0.0;
        vec4 clouds = raymarch(camPos, rd, wind, precipLocal);
        vec3 finalColor = mix(skyColor, clouds.rgb, clouds.a);

        // precipitation overlay: localized under dense cloud pockets
        float precipThreshold = 0.14; // lowered threshold so rain appears more readily
        float pStrength = max(0.0, (precipLocal - precipThreshold)) * precipIntensity * 0.9;

        if(pStrength > 0.001) {
          vec3 sampleP = camPos + rd * 1.2;
          float seed = fract(sin(dot(sampleP.xyz , vec3(12.9898,78.233,45.164))) * 43758.5453);
          // stronger streaks and longer smear when heavy
          float streak = rainStreak(gl_FragCoord.xy / resolution.xy, seed, 0.9 + wind.x * 0.6, clamp(pStrength, 0.0, 1.0));
          float streakSmooth = smoothstep(0.0, 0.9, streak) * smoothstep(0.0, 1.2, pStrength);
          vec3 rainCol = vec3(0.6, 0.7, 0.85) * 0.95;
          // blend rain as an additive sheen and subtle desaturation of base, stronger when heavy
          finalColor = mix(finalColor * (1.0 - 0.12*clamp(pStrength,0.0,1.0)), finalColor + rainCol * 0.9 * clamp(pStrength*1.2,0.0,1.0), clamp(streakSmooth * pStrength * 1.1, 0.0, 1.0));
          float groundFade = smoothstep(0.0, 0.6, 1.0 - clamp(rd.y + 0.5, 0.0, 1.0));
          finalColor = mix(finalColor, finalColor * 0.82, groundFade * clamp(pStrength * 0.9, 0.0, 1.0));
        }

        // LIGHTNING: short bright pulses that briefly brighten sky and clouds
        // lightning uniform is expected to be a short pulse (0..1)
        if (lightning > 0.001) {
          // brighten overall scene, emphasise cloud highlights
          vec3 flashCol = vec3(1.5,1.25,1.05) * pow(lightning, 0.6);
          finalColor += flashCol * (0.45 + 0.9 * clamp(precipLocal * 0.8, 0.0, 1.0));
          // also add directional rim highlight on cloud alpha
          finalColor = mix(finalColor, finalColor + vec3(1.0,0.9,0.8) * lightning * 0.8, clamp(lightning * 0.6, 0.0, 1.0));
        }

        fragColor = vec4(finalColor, 1.0);
      }
    `;

    function createShader(gl, type, source) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('Shader compile error:', gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    }

    const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
    const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
    if (!vertexShader || !fragmentShader) return;

    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.bindAttribLocation(program, 0, "position");
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Link error:', gl.getProgramInfoLog(program));
      return;
    }

    const positionLoc = 0;
    const resolutionLoc = gl.getUniformLocation(program, 'resolution');
    const timeLoc = gl.getUniformLocation(program, 'time');
    const camPosLoc = gl.getUniformLocation(program, 'camPos');
    const camFLoc = gl.getUniformLocation(program, 'camForward');
    const camRLoc = gl.getUniformLocation(program, 'camRight');
    const camULoc = gl.getUniformLocation(program, 'camUp');
    const windLoc = gl.getUniformLocation(program, 'windVec'); // UPDATED: vec2 uniform
    const samplesLoc = gl.getUniformLocation(program, 'samples');
    const growthSeedLoc = gl.getUniformLocation(program, 'growthSeed');
    const precipLoc = gl.getUniformLocation(program, 'precipIntensity');
    const spawnLoc = gl.getUniformLocation(program, 'cloudSpawnTime');
    const complexityLoc = gl.getUniformLocation(program, 'complexity'); // NEW
    const lightningLoc = gl.getUniformLocation(program, 'lightning'); // NEW

    const positions = new Float32Array([
      -1, -1,
       1, -1,
      -1,  1,
       1,  1,
    ]);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

    // --- THREE.js scene for simple terrain ---
    const threeRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    threeRenderer.setSize(300, 150); // small offscreen renderer
    threeRenderer.setPixelRatio(window.devicePixelRatio || 1);
    // create a small orthographic camera and scene with a terrain plane
    const threeScene = new THREE.Scene();
    const threeCam = new THREE.PerspectiveCamera(45, 300 / 150, 0.1, 1000);
    threeCam.position.set(0, 5, 6);
    threeCam.lookAt(0, 0, 0);
    const light = new THREE.DirectionalLight(0xffffff, 0.8);
    light.position.set(5, 10, 7);
    threeScene.add(light);
    const amb = new THREE.AmbientLight(0x777777);
    threeScene.add(amb);
    const geom = new THREE.PlaneGeometry(20, 20, 64, 64);
    // simple height displacement to suggest terrain
    for (let i = 0; i < geom.attributes.position.count; i++) {
      const y = Math.sin(i * 0.12) * 0.3 + Math.cos(i * 0.07) * 0.15;
      geom.attributes.position.setY(i, y);
    }
    geom.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0x557755, roughness: 1.0, metalness: 0.0 });
    const terrain = new THREE.Mesh(geom, mat);
    terrain.rotation.x = -Math.PI / 2;
    threeScene.add(terrain);
    // we won't append threeRenderer.domElement to DOM; use it for visual reference only
    // --- end THREE.js setup ---

    // helper to compute camera basis from yaw/pitch and position
    function computeCamera() {
      const yaw = camYaw.current;
      const pitch = camPitch.current;
      const cosP = Math.cos(pitch);
      const forward = [
        Math.sin(yaw) * cosP,
        Math.sin(pitch),
        Math.cos(yaw) * cosP
      ];
      const up = [0,1,0];
      // right = normalize(cross(up, forward))
      const right = [
        up[1]*forward[2] - up[2]*forward[1],
        up[2]*forward[0] - up[0]*forward[2],
        up[0]*forward[1] - up[1]*forward[0]
      ];
      // normalize right
      const rl = Math.hypot(right[0], right[1], right[2]) || 1;
      right[0]/=rl; right[1]/=rl; right[2]/=rl;
      // recompute up = cross(forward, right)
      const up2 = [
        forward[1]*right[2] - forward[2]*right[1],
        forward[2]*right[0] - forward[0]*right[2],
        forward[0]*right[1] - forward[1]*right[0]
      ];
      return { forward, right, up: up2 };
    }

    // simple input handling (WASD + mouse drag)
    const keys = {};
    function onKeyDown(e){ keys[e.key.toLowerCase()] = true; }
    function onKeyUp(e){ keys[e.key.toLowerCase()] = false; }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    // mouse control: drag to look
    canvas.addEventListener('mousedown', (e) => {
      mouseDownRef.current = true;
      lastMouseRef.current = [e.clientX, e.clientY];
      canvas.style.cursor = 'grabbing';
    });
    window.addEventListener('mouseup', () => {
      mouseDownRef.current = false;
      canvas.style.cursor = 'default';
    });
    window.addEventListener('mousemove', (e) => {
      if (!mouseDownRef.current) return;
      const [lx, ly] = lastMouseRef.current;
      const dx = e.clientX - lx;
      const dy = e.clientY - ly;
      lastMouseRef.current = [e.clientX, e.clientY];
      camYaw.current -= dx * 0.0025;
      camPitch.current = Math.max(-1.2, Math.min(1.2, camPitch.current - dy * 0.0025));
    });

    // removed mobile joystick: touch drag remains for look; movement via WASD

    // simple pointer touch drag to look for mobile
    canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        const t = e.touches[0];
        lastMouseRef.current = [t.clientX, t.clientY];
      }
    }, { passive: true });
    canvas.addEventListener('touchmove', (e) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      const [lx, ly] = lastMouseRef.current;
      const dx = t.clientX - lx;
      const dy = t.clientY - ly;
      lastMouseRef.current = [t.clientX, t.clientY];
      camYaw.current -= dx * 0.003;
      camPitch.current = Math.max(-1.2, Math.min(1.2, camPitch.current - dy * 0.003));
    }, { passive: true });

    function updateMovement(dt) {
      // keyboard -> moveVec (W/S forward/back, A/D left/right)
      const forward = (keys['w'] ? 1 : 0) - (keys['s'] ? 1 : 0);
      const strafe = (keys['d'] ? 1 : 0) - (keys['a'] ? 1 : 0);
      // merge keyboard and joystick (joystick has priority)
      const mvx = strafe * 1.0;
      const mvz = forward * 1.0;
      // apply relative to yaw
      const yaw = camYaw.current;
      const sinY = Math.sin(yaw), cosY = Math.cos(yaw);
      const speed = 1.6;
      camPos.current[0] += (mvx * cosY - mvz * sinY) * speed * dt;
      camPos.current[2] += (mvx * sinY + mvz * cosY) * speed * dt;
    }

    function render() {
      if (!isRunning) {
        animationRef.current = requestAnimationFrame(render);
        return;
      }

      resize();

      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);

      // update movement and time
      const dt = 0.016;
      updateMovement(dt);
      timeRef.current += dt;

      // compute camera basis
      const cam = computeCamera();
      const forward = cam.forward;
      const right = cam.right;
      const up = cam.up;
      const pos = camPos.current;

      gl.useProgram(program);
      gl.uniform2f(resolutionLoc, canvas.width, canvas.height);
      gl.uniform1f(timeLoc, timeRef.current);
      gl.uniform3f(camPosLoc, pos[0], pos[1], pos[2]);
      gl.uniform3f(camFLoc, forward[0], forward[1], forward[2]);
      gl.uniform3f(camRLoc, right[0], right[1], right[2]);
      gl.uniform3f(camULoc, up[0], up[1], up[2]);

      // wind derived from time to make clouds move around, also use cam yaw to vary
      // previously a scalar; now compute a 2D wind vector from speed+direction state
      const angle = (windAngle * Math.PI) / 180.0;
      const windX = Math.cos(angle) * windSpeed * (0.6 + 0.4 * Math.sin(timeRef.current * 0.12));
      const windZ = Math.sin(angle) * windSpeed * (0.6 + 0.4 * Math.cos(timeRef.current * 0.07));
      gl.uniform2f(windLoc, windX, windZ);

      // growth seed cycles slowly to produce cloud growth/evolution over time
      const growthSeed = Math.sin(timeRef.current * 0.07) * 0.5 + 0.5;
      gl.uniform1f(growthSeedLoc, growthSeed);

      // compute precipitation intensity from local growthSeed and wind - stronger where clouds are evolving
      const precipIntensity = Math.max(0.0, (growthSeed - 0.45) * 1.8); // bias to reduce spurious rain
      gl.uniform1f(precipLoc, precipIntensity);

      // supply cloud spawn time (seconds) so scene starts empty until clouds develop
      // much lower spawn time + tighter ramp for faster visible formation
      const cloudSpawnTime = 0.25;
      gl.uniform1f(spawnLoc, cloudSpawnTime);

      // samples slider (clamped)
      gl.uniform1i(samplesLoc, Math.max(8, Math.min(180, samples | 0)));

      // determine a complexity multiplier to drive heavier lighting paths in shader
      // complexity increases with wind/growth and samples to simulate GPU work
      const complexity = 1.0 + Math.abs(windSpeed) * 1.2 + (growthSeed - 0.5) * 0.8;
      gl.uniform1f(complexityLoc, complexity);

      // Lightning pulse generator: couple to precipIntensity and growth; produce rare sharp pulses
      // Use a deterministic pseudo-random pulse using sin/time and a seeded offset so flashes vary over time.
      const lightningBaseFreq = 0.6 + precipIntensity * 3.0; // controls flicker speed when raining
      const lightningSeed = Math.sin(timeRef.current * 0.23 + growthSeed * 7.2);
      // produce intermittent pulses: when sin wave crosses high threshold create a short envelope
      let lightningPulse = 0.0;
      const phase = (Math.sin(timeRef.current * lightningBaseFreq + lightningSeed * 6.54) + 1.0) * 0.5;
      if (phase > 0.94 && precipIntensity > 0.02) {
        // sharper pulse when precipitation high
        lightningPulse = Math.min(1.0, (phase - 0.94) * 25.0 * (0.6 + precipIntensity * 2.4));
      }
      // small random micro-flicker during heavy storms
      lightningPulse += Math.max(0, Math.sin(timeRef.current * 24.0 + lightningSeed * 40.0)) * 0.02 * precipIntensity;
      gl.uniform1f(lightningLoc, lightningPulse);

      // Estimate GPU load (%) from samples and complexity (smoothed & clamped)
      // This is an estimate for display only — more samples and higher complexity increase the percentage.
      const maxSamples = 180;
      const maxComplexity = 3.0; // heuristic cap
      let loadEstimate = (samples * (1.0 + (complexity - 1.0))) / (maxSamples * maxComplexity);
      loadEstimate = Math.min(1.0, Math.max(0.0, loadEstimate));
      // smooth updates to avoid jitter
      setGpuLoad(prev => Math.round(prev * 0.85 + loadEstimate * 100 * 0.15));

      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(positionLoc);
      gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      // render small three.js terrain in background to evolve slightly with time
      terrain.rotation.z = Math.sin(timeRef.current * 0.05) * 0.02;
      threeCam.position.x = Math.sin(timeRef.current * 0.1) * 1.2;
      threeCam.lookAt(0, 0, 0);
      threeRenderer.render(threeScene, threeCam);

      // FPS measurement
      const now = performance.now();
      const fref = fpsRef.current;
      fref.frames++;
      fref.accum += 1;
      if (now - fref.lastT >= 500) { // update twice a second
        const measured = (fref.frames * 1000) / (now - fref.lastT);
        setFps(Math.round(measured));
        fref.frames = 0;
        fref.lastT = now;
      }

      animationRef.current = requestAnimationFrame(render);
    }

    // start loop
    animationRef.current = requestAnimationFrame(render);

    // fullscreen change handler: keep canvas sized correctly
    function onFullscreenChange() {
      const fs = !!document.fullscreenElement;
      setIsFullscreen && setIsFullscreen(fs);
      // when entering/exiting fullscreen, force a resize so dpr scaling updates
      resize();
    }
    document.addEventListener('fullscreenchange', onFullscreenChange);

    window.addEventListener('resize', resize);
    // cleanup fullscreen listener on teardown
    // (onFullscreenChange added above when program is bound)

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      window.removeEventListener('resize', resize);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      // removed joystick manager cleanup (none exists now)
      try {
        gl.deleteBuffer(buffer);
        gl.deleteProgram(program);
        gl.deleteShader(vertexShader);
        gl.deleteShader(fragmentShader);
      } catch (e) {}
      try {
        threeRenderer.dispose();
      } catch (e) {}
    };
  }, [isRunning, samples]);

  return (
    <div style={{ width: '100%', display: 'flex', gap: 12 }}>
      <div className="side-panel">
        <div className="panel">
          <h1>Volumetric Clouds</h1>
          <p className="subtitle">Ray-marched clouds · realistic lighting</p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="controls-row">
            <button className="btn" onClick={() => setIsRunning(r => !r)}>
              {isRunning ? 'Pause' : 'Resume'}
            </button>
            <button
              className="btn"
              onClick={() => {
                const el = canvasRef.current && canvasRef.current.parentElement;
                if (!el) return;
                if (!document.fullscreenElement) {
                  el.requestFullscreen?.();
                } else {
                  document.exitFullscreen?.();
                }
              }}
              title="Toggle fullscreen"
            >
              Toggle FS
            </button>
            <button
              className="btn"
              onClick={() => setEditorOpen(v => !v)}
              title="Toggle code editor"
            >
              {editorOpen ? 'Close' : 'Editor'}
            </button>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={{ fontSize: 13, color: '#bfe' }}>FPS</div>
              <div className="stat">{fps}</div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={{ fontSize: 13, color: '#bfe' }}>GPU</div>
              <div className="stat">{gpuLoad}%</div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label className="small">Samples: {samples}</label>
            <input
              aria-label="samples"
              type="range"
              min="8"
              max="360"
              value={samples}
              onChange={(e) => setSamples(parseInt(e.target.value, 10))}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label className="small">Wind</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                aria-label="windSpeed"
                type="range"
                min="0"
                max="1.2"
                step="0.01"
                value={windSpeed}
                onChange={(e) => setWindSpeed(parseFloat(e.target.value))}
                style={{ flex: 1 }}
              />
              <div style={{ minWidth: 48, textAlign: 'right', fontSize: 13 }}>{windSpeed.toFixed(2)}</div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                aria-label="windAngle"
                type="range"
                min="0"
                max="360"
                value={windAngle}
                onChange={(e) => setWindAngle(parseInt(e.target.value, 10))}
                style={{ flex: 1 }}
              />
              <div style={{ minWidth: 48, textAlign: 'right', fontSize: 13 }}>{windAngle}°</div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              className="btn"
              onClick={() => {
                navigator.clipboard?.writeText(editorText).catch(()=>{});
              }}
            >
              Copy
            </button>
            <button
              className="btn"
              onClick={() => {
                setEditorText('// Reset editor\n');
              }}
            >
              Reset
            </button>
          </div>

          <div className="footer" style={{ marginTop: 6 }}>
            Fractal noise • Beer's law • WASD/mouse • Wind-driven clouds
          </div>
        </div>

        {/* editor (inline in side panel) */}
        {editorOpen && (
          <textarea
            className="editor"
            value={editorText}
            onChange={(e) => setEditorText(e.target.value)}
            spellCheck={false}
          />
        )}
      </div>

      <div className="main">
        <div className="canvas-wrap" style={{ touchAction: 'none' }}>
          <canvas ref={canvasRef} />
          <div className="overlay" aria-hidden={false}>
            <div className="panel-inner" role="toolbar">
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <div className="stat">FPS: {fps}</div>
                  <div className="stat">GPU: {gpuLoad}%</div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <div style={{ fontSize: 13, color: '#cfe' }}>Samples</div>
                  <div style={{ minWidth: 36, textAlign: 'right', fontSize: 13 }}>{samples}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VolumetricClouds;