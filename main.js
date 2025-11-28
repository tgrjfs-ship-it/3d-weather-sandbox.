import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

const VolumetricClouds = () => {
  const containerRef = useRef(null);
  const [stats, setStats] = useState({
    cloudCount: 0,
    precipitation: 'None',
    temperature: 20,
    humidity: 50,
    cloudTypes: {}
  });
  const [controls, setControls] = useState({
    evaporationRate: 1.0,
    simulationSpeed: 1.0
  });

  useEffect(() => {
    if (!containerRef.current) return;

    // Scene setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB);
    scene.fog = new THREE.Fog(0x87CEEB, 50, 200);

    const camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    camera.position.set(0, 15, 50);
    camera.lookAt(0, 10, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    containerRef.current.appendChild(renderer.domElement);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(0xfff4e6, 1.2);
    sunLight.position.set(50, 80, 30);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    scene.add(sunLight);

    const backLight = new THREE.DirectionalLight(0x6ba3ff, 0.4);
    backLight.position.set(-50, 30, -50);
    scene.add(backLight);

    // Cloud shader material
    const createCloudMaterial = () => new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        density: { value: 0.3 },
        lightColor: { value: new THREE.Color(0xffffff) },
        shadowColor: { value: new THREE.Color(0x6688aa) },
        moisture: { value: 0.5 }
      },
      vertexShader: `
        varying vec3 vPosition;
        varying vec3 vNormal;
        varying vec2 vUv;
        
        void main() {
          vPosition = position;
          vNormal = normal;
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float time;
        uniform float density;
        uniform vec3 lightColor;
        uniform vec3 shadowColor;
        uniform float moisture;
        
        varying vec3 vPosition;
        varying vec3 vNormal;
        varying vec2 vUv;
        
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
            f.z
          );
        }
        
        float fbm(vec3 p) {
          float f = 0.0;
          float scale = 1.0;
          float weight = 0.5;
          
          for(int i = 0; i < 6; i++) {
            f += weight * noise(p * scale);
            scale *= 2.0;
            weight *= 0.5;
          }
          
          return f;
        }
        
        void main() {
          vec3 pos = vPosition * 0.5;
          pos.x += time * 0.05;
          
          float n = fbm(pos);
          n = smoothstep(0.3, 0.8, n);
          
          vec3 lightDir = normalize(vec3(1.0, 1.0, 0.5));
          float lightAmount = dot(normalize(vNormal), lightDir) * 0.5 + 0.5;
          
          vec3 darkColor = mix(shadowColor, vec3(0.2, 0.2, 0.3), moisture);
          vec3 color = mix(darkColor, lightColor, lightAmount);
          
          float alpha = n * density * (0.5 + moisture * 0.5);
          alpha *= (1.0 - smoothstep(0.0, 1.0, length(vUv - 0.5) * 2.0));
          
          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });

    // Cloud system with lifecycle
    class CloudSystem {
      constructor() {
        this.clouds = [];
        this.maxClouds = 18;
        this.temperature = 20;
        this.humidity = 50;
        this.evaporationRate = 1.0;
      }

      determineCloudType() {
        const rand = Math.random();
        const humidity = this.humidity;
        
        if (humidity > 75 && rand > 0.7) return 'cumulonimbus';
        if (humidity > 70 && rand > 0.6) return 'cumulus_congestus';
        if (humidity > 60 && rand > 0.5) return 'cumulus_mediocris';
        if (rand > 0.7) return 'stratocumulus';
        return 'cumulus_humilis';
      }

      createCloud() {
        const cloudType = this.determineCloudType();
        
        const cloudGroup = new THREE.Group();
        
        cloudGroup.position.x = (Math.random() - 0.5) * 80;
        cloudGroup.position.y = Math.random() * 20 + 5;
        cloudGroup.position.z = (Math.random() - 0.5) * 80;
        
        // Determine precipitation capability
        let canPrecipitate = false;
        let precipitationThreshold = 0.8;
        
        if (cloudType === 'cumulonimbus') {
          canPrecipitate = true;
          precipitationThreshold = 0.6;
        } else if (cloudType === 'cumulus_congestus') {
          canPrecipitate = true;
          precipitationThreshold = 0.7;
        } else if (cloudType === 'cumulus_mediocris' && Math.random() > 0.7) {
          canPrecipitate = true;
          precipitationThreshold = 0.8;
        }
        
        cloudGroup.userData = {
          speed: 0.02 + Math.random() * 0.03,
          rotationSpeed: (Math.random() - 0.5) * 0.002,
          initialY: cloudGroup.position.y,
          floatSpeed: 0.3 + Math.random() * 0.2,
          age: 0,
          maxAge: 300 + Math.random() * 200,
          moisture: Math.random() * 0.5 + 0.3,
          growth: 0.5 + Math.random() * 0.5,
          stage: 'growing',
          baseScale: 1 + Math.random() * 0.8,
          precipitating: false,
          canPrecipitate,
          precipitationThreshold,
          type: cloudType,
          structureElements: [],
          precipitationIntensity: 0
        };

        cloudGroup.scale.set(0.1, 0.1, 0.1);
        
        // Build cloud structure
        this.buildCloudStructure(cloudGroup, cloudType);
        
        scene.add(cloudGroup);
        this.clouds.push(cloudGroup);
        return cloudGroup;
      }

      buildCloudStructure(cloudGroup, type) {
        switch(type) {
          case 'cumulus_humilis':
            this.buildCumulusHumilis(cloudGroup);
            break;
          case 'cumulus_mediocris':
            this.buildCumulusMediocris(cloudGroup);
            break;
          case 'cumulus_congestus':
            this.buildCumulusCongestus(cloudGroup);
            break;
          case 'cumulonimbus':
            this.buildCumulonimbus(cloudGroup);
            break;
          case 'stratocumulus':
            this.buildStratocumulus(cloudGroup);
            break;
        }
      }

      buildCumulusHumilis(cloudGroup) {
        // Small, flat cumulus clouds
        const layers = 2;
        
        for (let layer = 0; layer < layers; layer++) {
          const layerY = layer * 2;
          const puffsInLayer = 5;
          
          for (let i = 0; i < puffsInLayer; i++) {
            const angle = (i / puffsInLayer) * Math.PI * 2;
            const radius = 5 + Math.random() * 2;
            const size = 2 + Math.random() * 2;
            
            const puffGeom = new THREE.SphereGeometry(size, 16, 16);
            const puff = new THREE.Mesh(puffGeom, createCloudMaterial());
            
            puff.position.set(
              Math.cos(angle) * radius,
              layerY,
              Math.sin(angle) * radius
            );
            
            puff.scale.set(1.2, 0.5, 1.2);
            
            cloudGroup.add(puff);
            cloudGroup.userData.structureElements.push(puff);
          }
        }
      }

      buildCumulusMediocris(cloudGroup) {
        // Medium-sized cumulus with moderate vertical development
        const layers = 3;
        
        for (let layer = 0; layer < layers; layer++) {
          const layerY = layer * 3.5;
          const layerRadius = 10 - layer * 1.5;
          const puffsInLayer = 7 - layer;
          
          for (let i = 0; i < puffsInLayer; i++) {
            const angle = (i / puffsInLayer) * Math.PI * 2;
            const radius = layerRadius * (0.6 + Math.random() * 0.4);
            const size = 3 + Math.random() * 2.5;
            
            const puffGeom = new THREE.SphereGeometry(size, 16, 16);
            const puff = new THREE.Mesh(puffGeom, createCloudMaterial());
            
            puff.position.set(
              Math.cos(angle) * radius,
              layerY,
              Math.sin(angle) * radius
            );
            
            cloudGroup.add(puff);
            cloudGroup.userData.structureElements.push(puff);
          }
        }
        
        // Add top
        const topGeom = new THREE.SphereGeometry(5, 20, 20);
        const topPuff = new THREE.Mesh(topGeom, createCloudMaterial());
        topPuff.position.y = layers * 3.5;
        cloudGroup.add(topPuff);
        cloudGroup.userData.structureElements.push(topPuff);
      }

      buildCumulusCongestus(cloudGroup) {
        // Towering cumulus with strong vertical development
        const baseRadius = 12;
        const height = 20;
        const layers = 5;
        
        for (let layer = 0; layer < layers; layer++) {
          const layerY = layer * 4;
          const layerRadius = baseRadius * (1 - layer * 0.12);
          const puffsInLayer = 8;
          
          for (let i = 0; i < puffsInLayer; i++) {
            const angle = (i / puffsInLayer) * Math.PI * 2;
            const radius = layerRadius * (0.6 + Math.random() * 0.4);
            const size = 4 + Math.random() * 2.5;
            
            const puffGeom = new THREE.SphereGeometry(size, 16, 16);
            const puff = new THREE.Mesh(puffGeom, createCloudMaterial());
            
            puff.position.set(
              Math.cos(angle) * radius,
              layerY,
              Math.sin(angle) * radius
            );
            
            cloudGroup.add(puff);
            cloudGroup.userData.structureElements.push(puff);
          }
        }
        
        // Cauliflower top
        const topLayers = 2;
        for (let tl = 0; tl < topLayers; tl++) {
          const topGeom = new THREE.SphereGeometry(6 - tl, 20, 20);
          const topPuff = new THREE.Mesh(topGeom, createCloudMaterial());
          topPuff.position.y = height + tl * 3;
          cloudGroup.add(topPuff);
          cloudGroup.userData.structureElements.push(topPuff);
        }
      }

      buildCumulonimbus(cloudGroup) {
        // Massive storm cloud with anvil top
        const baseRadius = 15;
        const height = 30;
        
        // Towering column
        const columnLayers = 7;
        for (let layer = 0; layer < columnLayers; layer++) {
          const layerY = layer * 4.5;
          const layerRadius = baseRadius * (1 - layer * 0.08);
          const puffsInLayer = 12;
          
          for (let i = 0; i < puffsInLayer; i++) {
            const angle = (i / puffsInLayer) * Math.PI * 2;
            const radius = layerRadius * (0.6 + Math.random() * 0.4);
            const size = 4 + Math.random() * 3;
            
            const puffGeom = new THREE.SphereGeometry(size, 16, 16);
            const puff = new THREE.Mesh(puffGeom, createCloudMaterial());
            
            puff.position.set(
              Math.cos(angle) * radius,
              layerY,
              Math.sin(angle) * radius
            );
            
            cloudGroup.add(puff);
            cloudGroup.userData.structureElements.push(puff);
          }
        }
        
        // Anvil top
        const anvilY = height - 5;
        const anvilLayers = 3;
        
        for (let layer = 0; layer < anvilLayers; layer++) {
          const anvilRadius = 22 + layer * 6;
          const anvilPuffs = 14 + layer * 2;
          
          for (let i = 0; i < anvilPuffs; i++) {
            const angle = (i / anvilPuffs) * Math.PI * 2;
            const radius = anvilRadius * (0.7 + Math.random() * 0.3);
            const size = 5 + Math.random() * 3;
            
            const puffGeom = new THREE.SphereGeometry(size, 16, 16);
            const puff = new THREE.Mesh(puffGeom, createCloudMaterial());
            
            puff.position.set(
              Math.cos(angle) * radius,
              anvilY + layer * 2,
              Math.sin(angle) * radius
            );
            
            puff.scale.set(1.5, 0.4, 1.5);
            
            cloudGroup.add(puff);
            cloudGroup.userData.structureElements.push(puff);
          }
        }
        
        // Turbulent core
        for (let i = 0; i < 20; i++) {
          const puffGeom = new THREE.SphereGeometry(3 + Math.random() * 2, 12, 12);
          const puff = new THREE.Mesh(puffGeom, createCloudMaterial());
          
          puff.position.set(
            (Math.random() - 0.5) * 14,
            Math.random() * height,
            (Math.random() - 0.5) * 14
          );
          
          cloudGroup.add(puff);
          cloudGroup.userData.structureElements.push(puff);
        }
      }

      buildStratocumulus(cloudGroup) {
        // Horizontal layered clouds
        const width = 25;
        const depth = 20;
        const layers = 2;
        
        for (let layer = 0; layer < layers; layer++) {
          const layerY = layer * 3;
          const rolls = 4;
          
          for (let roll = 0; roll < rolls; roll++) {
            const rollZ = (roll / rolls) * depth - depth / 2;
            const puffsInRoll = 8;
            
            for (let i = 0; i < puffsInRoll; i++) {
              const x = (i / puffsInRoll) * width - width / 2;
              const size = 4 + Math.random() * 3;
              
              const puffGeom = new THREE.SphereGeometry(size, 16, 16);
              const puff = new THREE.Mesh(puffGeom, createCloudMaterial());
              
              puff.position.set(
                x + (Math.random() - 0.5) * 3,
                layerY + (Math.random() - 0.5) * 2,
                rollZ + (Math.random() - 0.5) * 3
              );
              
              puff.scale.set(1.5, 0.5, 1.2);
              
              cloudGroup.add(puff);
              cloudGroup.userData.structureElements.push(puff);
            }
          }
        }
      }

      updateCloud(cloud, deltaTime) {
        cloud.userData.age += deltaTime;
        const lifeRatio = cloud.userData.age / cloud.userData.maxAge;

        // Growth stages
        if (lifeRatio < 0.2) {
          cloud.userData.stage = 'growing';
          const growthScale = (lifeRatio / 0.2) * cloud.userData.growth;
          cloud.scale.set(
            cloud.userData.baseScale * growthScale,
            cloud.userData.baseScale * growthScale * 0.6,
            cloud.userData.baseScale * growthScale
          );
          
          cloud.userData.structureElements.forEach((element, idx) => {
            const turbulence = Math.sin(cloud.userData.age * 2 + idx) * 0.1;
            element.position.y += turbulence * deltaTime;
          });
          
        } else if (lifeRatio < 0.7) {
          cloud.userData.stage = 'mature';
          
          // Internal turbulence
          cloud.userData.structureElements.forEach((element, idx) => {
            const phase = cloud.userData.age * 0.5 + idx;
            element.position.y += Math.sin(phase) * 0.02 * deltaTime;
            
            // Vertical growth for tall clouds
            if ((cloud.userData.type === 'cumulonimbus' || 
                 cloud.userData.type === 'cumulus_congestus') && 
                cloud.userData.moisture > 0.7) {
              if (element.position.y > 15) {
                element.scale.y *= 1.001;
              }
            }
          });
          
          // Check precipitation conditions
          if (cloud.userData.canPrecipitate && 
              cloud.userData.moisture > cloud.userData.precipitationThreshold && 
              this.humidity > 60) {
            cloud.userData.precipitating = true;
            cloud.userData.precipitationIntensity = 
              (cloud.userData.moisture - cloud.userData.precipitationThreshold) / 
              (1 - cloud.userData.precipitationThreshold);
            
            // Lose moisture while raining, but gain from humidity
            cloud.userData.moisture += deltaTime * 0.0005 - 
              deltaTime * 0.002 * cloud.userData.precipitationIntensity * this.evaporationRate;
          } else {
            cloud.userData.precipitating = false;
            cloud.userData.precipitationIntensity = 0;
          }
        } else {
          cloud.userData.stage = 'dissipating';
          const dissipate = 1 - ((lifeRatio - 0.7) / 0.3);
          cloud.userData.structureElements.forEach(element => {
            element.material.uniforms.density.value = 0.3 * dissipate;
          });
          cloud.userData.precipitating = false;
        }

        // Environmental moisture exchange
        if (this.humidity > 70) {
          cloud.userData.moisture = Math.min(1, 
            cloud.userData.moisture + deltaTime * 0.002 / this.evaporationRate);
        } else if (this.humidity < 40) {
          cloud.userData.moisture = Math.max(0.2, 
            cloud.userData.moisture - deltaTime * 0.001 * this.evaporationRate);
        }

        // Update materials
        cloud.userData.structureElements.forEach(element => {
          element.material.uniforms.moisture.value = cloud.userData.moisture;
        });

        if (lifeRatio >= 1) {
          return true;
        }

        return false;
      }

      update(deltaTime) {
        if (this.clouds.length < this.maxClouds && Math.random() < this.humidity / 5000) {
          this.createCloud();
        }

        for (let i = this.clouds.length - 1; i >= 0; i--) {
          const cloud = this.clouds[i];
          const shouldRemove = this.updateCloud(cloud, deltaTime);
          
          if (shouldRemove) {
            scene.remove(cloud);
            cloud.userData.structureElements.forEach(element => {
              element.geometry.dispose();
              element.material.dispose();
            });
            this.clouds.splice(i, 1);
          }
        }
      }

      getPrecipitatingClouds() {
        return this.clouds.filter(c => c.userData.precipitating);
      }
    }

    // Localized precipitation system
    class PrecipitationSystem {
      constructor() {
        this.rainSystems = new Map(); // One system per cloud
        this.maxParticlesPerCloud = 500;
      }

      getOrCreateRainSystem(cloud) {
        if (!this.rainSystems.has(cloud)) {
          const geometry = new THREE.BufferGeometry();
          const positions = new Float32Array(this.maxParticlesPerCloud * 3);
          const velocities = new Float32Array(this.maxParticlesPerCloud);
          
          geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
          geometry.setAttribute('velocity', new THREE.BufferAttribute(velocities, 1));
          
          const material = new THREE.PointsMaterial({
            color: 0x6ba3d4,
            size: 0.3,
            transparent: true,
            opacity: 0.6,
            blending: THREE.AdditiveBlending
          });
          
          const system = new THREE.Points(geometry, material);
          scene.add(system);
          
          this.rainSystems.set(cloud, {
            system,
            geometry,
            material,
            activeParticles: 0
          });
        }
        
        return this.rainSystems.get(cloud);
      }

      update(precipitatingClouds) {
        // Remove rain systems for clouds that stopped precipitating
        for (const [cloud, rainData] of this.rainSystems.entries()) {
          if (!precipitatingClouds.includes(cloud)) {
            scene.remove(rainData.system);
            rainData.geometry.dispose();
            rainData.material.dispose();
            this.rainSystems.delete(cloud);
          }
        }

        // Update rain for precipitating clouds
        precipitatingClouds.forEach(cloud => {
          const rainData = this.getOrCreateRainSystem(cloud);
          const positions = rainData.geometry.attributes.position.array;
          const velocities = rainData.geometry.attributes.velocity.array;
          
          const intensity = cloud.userData.precipitationIntensity;
          const spawnRate = Math.floor(intensity * 8);
          
          // Spawn new raindrops
          for (let i = 0; i < spawnRate; i++) {
            if (rainData.activeParticles < this.maxParticlesPerCloud && Math.random() < 0.4) {
              const idx = rainData.activeParticles * 3;
              
              // Get cloud world position
              const cloudPos = new THREE.Vector3();
              cloud.getWorldPosition(cloudPos);
              
              const spread = 12 * cloud.scale.x;
              
              positions[idx] = cloudPos.x + (Math.random() - 0.5) * spread;
              positions[idx + 1] = cloudPos.y - 2 + (Math.random() - 0.5) * 6;
              positions[idx + 2] = cloudPos.z + (Math.random() - 0.5) * spread;
              
              velocities[rainData.activeParticles] = -0.5 - Math.random() * 0.4 - intensity * 0.3;
              
              rainData.activeParticles++;
            }
          }
          
          // Update existing particles
          let writeIdx = 0;
          for (let i = 0; i < rainData.activeParticles; i++) {
            const idx = i * 3;
            positions[idx + 1] += velocities[i];
            
            if (positions[idx + 1] > 0) {
              if (writeIdx !== i) {
                positions[writeIdx * 3] = positions[idx];
                positions[writeIdx * 3 + 1] = positions[idx + 1];
                positions[writeIdx * 3 + 2] = positions[idx + 2];
                velocities[writeIdx] = velocities[i];
              }
              writeIdx++;
            }
          }
          
          rainData.activeParticles = writeIdx;
          
          rainData.geometry.attributes.position.needsUpdate = true;
          rainData.geometry.attributes.velocity.needsUpdate = true;
          rainData.geometry.setDrawRange(0, rainData.activeParticles);
        });
      }

      cleanup() {
        for (const [cloud, rainData] of this.rainSystems.entries()) {
          scene.remove(rainData.system);
          rainData.geometry.dispose();
          rainData.material.dispose();
        }
        this.rainSystems.clear();
      }
    }

    // Complex lightning system
    class LightningSystem {
      constructor() {
        this.flashLights = [];
        this.activeBolts = [];
        this.shakeIntensity = 0;
        this.shakeDecay = 0.9;
        
        // Create multiple flash lights for better effect
        for (let i = 0; i < 3; i++) {
          const light = new THREE.PointLight(0xaaccff, 0, 100);
          scene.add(light);
          this.flashLights.push(light);
        }
      }

      createBranch(start, end, depth = 0, maxDepth = 3) {
        const points = [start.clone()];
        const steps = 8 - depth * 2;
        
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          const point = new THREE.Vector3().lerpVectors(start, end, t);
          
          // Add randomness
          point.x += (Math.random() - 0.5) * (3 - depth);
          point.z += (Math.random() - 0.5) * (3 - depth);
          
          points.push(point);
          
          // Create sub-branches
          if (depth < maxDepth && Math.random() < 0.3 - depth * 0.1) {
            const branchEnd = point.clone();
            branchEnd.x += (Math.random() - 0.5) * 15;
            branchEnd.y -= Math.random() * 8;
            branchEnd.z += (Math.random() - 0.5) * 15;
            
            const subBranch = this.createBranch(point, branchEnd, depth + 1, maxDepth);
            points.push(...subBranch);
          }
        }
        
        return points;
      }

      trigger(cloud) {
        const cloudPos = new THREE.Vector3();
        cloud.getWorldPosition(cloudPos);
        
        // Position lights
        this.flashLights.forEach((light, i) => {
          light.position.set(
            cloudPos.x + (Math.random() - 0.5) * 20,
            cloudPos.y,
            cloudPos.z + (Math.random() - 0.5) * 20
          );
          light.intensity = 6 + Math.random() * 4;
        });
        
        // Create main bolt
        const groundPos = cloudPos.clone();
        groundPos.y = 0;
        
        const mainPoints = this.createBranch(cloudPos, groundPos, 0, 3);
        
        // Create bolt geometry
        const geometry = new THREE.BufferGeometry().setFromPoints(mainPoints);
        const material = new THREE.LineBasicMaterial({ 
          color: 0xffffff, 
          opacity: 0.9, 
          transparent: true,
          linewidth: 2
        });
        const bolt = new THREE.Line(geometry, material);
        
        scene.add(bolt);
        this.activeBolts.push({ bolt, age: 0 });
        
        // Camera shake
        this.shakeIntensity = 2.5;
        
        // Flash effect
        scene.background = new THREE.Color(0xFFFFFF);
        setTimeout(() => {
          scene.background = new THREE.Color(0x87CEEB);
        }, 50);
        
        // Fade out
        setTimeout(() => {
          this.flashLights.forEach(light => {
            light.intensity = 0;
          });
        }, 150);
      }

      update(stormClouds, deltaTime) {
        // Update camera shake
        if (this.shakeIntensity > 0.01) {
          camera.position.x += (Math.random() - 0.5) * this.shakeIntensity;
          camera.position.y += (Math.random() - 0.5) * this.shakeIntensity;
          this.shakeIntensity *= this.shakeDecay;
        }
        
        // Trigger lightning from storm clouds
        stormClouds.forEach(cloud => {
          const stormPotential = cloud.userData.moisture * cloud.userData.precipitationIntensity;
          
          if (cloud.userData.type === 'cumulonimbus' && stormPotential > 0.7) {
            if (Math.random() < 0.003) {
              this.trigger(cloud);
            }
          } else if (cloud.userData.type === 'cumulus_congestus' && stormPotential > 0.8) {
            if (Math.random() < 0.001) {
              this.trigger(cloud);
            }
          }
        });
        
        // Update and remove old bolts
        for (let i = this.activeBolts.length - 1; i >= 0; i--) {
          const boltData = this.activeBolts[i];
          boltData.age += deltaTime;
          
          if (boltData.age > 0.2) {
            scene.remove(boltData.bolt);
            boltData.bolt.geometry.dispose();
            boltData.bolt.material.dispose();
            this.activeBolts.splice(i, 1);
          } else {
            // Fade out
            boltData.bolt.material.opacity = 0.9 * (1 - boltData.age / 0.2);
          }
        }
      }

      cleanup() {
        this.flashLights.forEach(light => {
          scene.remove(light);
        });
        this.activeBolts.forEach(boltData => {
          scene.remove(boltData.bolt);
          boltData.bolt.geometry.dispose();
          boltData.bolt.material.dispose();
        });
      }
    }

    const cloudSystem = new CloudSystem();
    const precipSystem = new PrecipitationSystem();
    const lightningSystem = new LightningSystem();

    // Initialize clouds
    for (let i = 0; i < 10; i++) {
      cloudSystem.createCloud();
    }

    // Ground
    const groundGeometry = new THREE.PlaneGeometry(500, 500);
    const groundMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x5a8a3a,
      roughness: 0.9
    });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0;
    ground.receiveShadow = true;
    scene.add(ground);

    // Mouse interaction
    let mouseX = 0;
    let mouseY = 0;
    let targetCameraX = 0;
    let targetCameraY = 20;

    const handleMouseMove = (e) => {
      mouseX = (e.clientX / window.innerWidth) * 2 - 1;
      mouseY = -(e.clientY / window.innerHeight) * 2 + 1;
      targetCameraX = mouseX * 20;
      targetCameraY = mouseY * 10 + 20;
    };

    window.addEventListener('mousemove', handleMouseMove);

    // Animation loop
    let time = 0;
    let lastTime = Date.now();

    const animate = () => {
      requestAnimationFrame(animate);
      
      const now = Date.now();
      const deltaTime = ((now - lastTime) / 1000) * controls.simulationSpeed;
      lastTime = now;
      
      time += 0.01 * controls.simulationSpeed;

      // Update camera with smooth following
      camera.position.x += (targetCameraX - camera.position.x) * 0.05;
      camera.position.y += (targetCameraY - camera.position.y) * 0.05;
      camera.lookAt(0, 10, 0);

      // Environmental changes
      cloudSystem.humidity = 50 + Math.sin(time * 0.1) * 30;
      cloudSystem.temperature = 20 + Math.sin(time * 0.05) * 10;
      cloudSystem.evaporationRate = controls.evaporationRate;

      // Update systems
      cloudSystem.update(deltaTime);
      
      const precipClouds = cloudSystem.getPrecipitatingClouds();
      precipSystem.update(precipClouds);
      lightningSystem.update(precipClouds, deltaTime);

      // Animate clouds
      cloudSystem.clouds.forEach((cloud, i) => {
        cloud.position.x += cloud.userData.speed * controls.simulationSpeed;
        
        if (cloud.position.x > 100) {
          cloud.position.x = -100;
        }
        
        cloud.position.y = cloud.userData.initialY + 
          Math.sin(time * cloud.userData.floatSpeed + i) * 2;
        
        cloud.rotation.y += cloud.userData.rotationSpeed * controls.simulationSpeed;
        
        cloud.userData.structureElements.forEach(element => {
          element.material.uniforms.time.value = time;
        });
      });

      // Update stats
      const cloudTypes = {
        'Cumulus Humilis': 0,
        'Cumulus Mediocris': 0,
        'Cumulus Congestus': 0,
        'Cumulonimbus': 0,
        'Stratocumulus': 0
      };
      
      cloudSystem.clouds.forEach(cloud => {
        const typeMap = {
          'cumulus_humilis': 'Cumulus Humilis',
          'cumulus_mediocris': 'Cumulus Mediocris',
          'cumulus_congestus': 'Cumulus Congestus',
          'cumulonimbus': 'Cumulonimbus',
          'stratocumulus': 'Stratocumulus'
        };
        cloudTypes[typeMap[cloud.userData.type]]++;
      });
      
      setStats({
        cloudCount: cloudSystem.clouds.length,
        precipitation: precipClouds.length > 0 ? `Active (${precipClouds.length} clouds)` : 'None',
        temperature: cloudSystem.temperature.toFixed(1),
        humidity: cloudSystem.humidity.toFixed(1),
        cloudTypes
      });

      renderer.render(scene, camera);
    };

    animate();

    // Handle resize
    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };

    window.addEventListener('resize', handleResize);

    // Cleanup
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('resize', handleResize);
      containerRef.current?.removeChild(renderer.domElement);
      cloudSystem.clouds.forEach(cloud => {
        scene.remove(cloud);
        cloud.userData.structureElements.forEach(element => {
          element.geometry.dispose();
          element.material.dispose();
        });
      });
      precipSystem.cleanup();
      lightningSystem.cleanup();
      ground.geometry.dispose();
      ground.material.dispose();
      renderer.dispose();
    };
  }, [controls]);

  return (
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden', margin: 0, padding: 0 }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      
      {/* Stats Panel */}
      <div style={{
        position: 'absolute',
        top: '20px',
        left: '20px',
        color: 'white',
        fontFamily: 'Arial, sans-serif',
        textShadow: '2px 2px 4px rgba(0,0,0,0.5)',
        pointerEvents: 'none',
        background: 'rgba(0,0,0,0.4)',
        padding: '15px',
        borderRadius: '8px',
        maxWidth: '300px'
      }}>
        <h2 style={{ margin: '0 0 15px 0', fontSize: '18px' }}>Weather Simulation</h2>
        <div style={{ fontSize: '13px', lineHeight: '1.8' }}>
          <div><strong>Clouds:</strong> {stats.cloudCount}</div>
          <div style={{ marginLeft: '10px', fontSize: '11px', opacity: 0.9, lineHeight: '1.5' }}>
            {Object.entries(stats.cloudTypes).map(([type, count]) => (
              count > 0 && <div key={type}>{type}: {count}</div>
            ))}
          </div>
          <div><strong>Precipitation:</strong> {stats.precipitation}</div>
          <div><strong>Temperature:</strong> {stats.temperature}°C</div>
          <div><strong>Humidity:</strong> {stats.humidity}%</div>
        </div>
      </div>

      {/* Controls Panel */}
      <div style={{
        position: 'absolute',
        bottom: '20px',
        left: '20px',
        color: 'white',
        fontFamily: 'Arial, sans-serif',
        background: 'rgba(0,0,0,0.4)',
        padding: '15px',
        borderRadius: '8px',
        pointerEvents: 'auto',
        minWidth: '280px'
      }}>
        <h3 style={{ margin: '0 0 15px 0', fontSize: '16px' }}>Simulation Controls</h3>
        
        <div style={{ marginBottom: '15px' }}>
          <label style={{ display: 'block', fontSize: '13px', marginBottom: '5px' }}>
            Evaporation Rate: {controls.evaporationRate.toFixed(2)}x
          </label>
          <input
            type="range"
            min="0.1"
            max="3"
            step="0.1"
            value={controls.evaporationRate}
            onChange={(e) => setControls(prev => ({ ...prev, evaporationRate: parseFloat(e.target.value) }))}
            style={{ width: '100%' }}
          />
          <div style={{ fontSize: '11px', opacity: 0.7, marginTop: '3px' }}>
            Higher = clouds dry faster
          </div>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '13px', marginBottom: '5px' }}>
            Simulation Speed: {controls.simulationSpeed.toFixed(2)}x
          </label>
          <input
            type="range"
            min="0.1"
            max="3"
            step="0.1"
            value={controls.simulationSpeed}
            onChange={(e) => setControls(prev => ({ ...prev, simulationSpeed: parseFloat(e.target.value) }))}
            style={{ width: '100%' }}
          />
          <div style={{ fontSize: '11px', opacity: 0.7, marginTop: '3px' }}>
            Controls time flow
          </div>
        </div>
      </div>

      {/* Info */}
      <div style={{
        position: 'absolute',
        top: '20px',
        right: '20px',
        color: 'white',
        fontFamily: 'Arial, sans-serif',
        textShadow: '2px 2px 4px rgba(0,0,0,0.5)',
        pointerEvents: 'none',
        background: 'rgba(0,0,0,0.3)',
        padding: '12px',
        borderRadius: '8px',
        fontSize: '12px',
        maxWidth: '250px',
        lineHeight: '1.6'
      }}>
        <div>🌤️ <strong>Cumulus Humilis:</strong> Small fair-weather</div>
        <div>☁️ <strong>Cumulus Mediocris:</strong> Medium with some rain</div>
        <div>⛈️ <strong>Cumulus Congestus:</strong> Towering with heavy rain</div>
        <div>🌩️ <strong>Cumulonimbus:</strong> Massive storms with lightning</div>
        <div>🌫️ <strong>Stratocumulus:</strong> Layered sheets</div>
      </div>
    </div>
  );
};

export default VolumetricClouds;