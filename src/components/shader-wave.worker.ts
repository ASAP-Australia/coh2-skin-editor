// shader-wave.worker.ts — Three.js wave shader rendered in a worker thread
// via OffscreenCanvas. Owns the renderer/scene/camera/mesh/uniforms and the
// rAF tick loop. Receives control messages from the main thread; never touches
// DOM, window, document, or matchMedia.

import {
  WebGLRenderer,
  Scene,
  PerspectiveCamera,
  PlaneGeometry,
  Vector2,
  ShaderMaterial,
  Mesh,
  Raycaster,
  Timer,
} from 'three'

// ---------------------------------------------------------------------------
// GLSL — identical to the constants in ShaderWaveBackground.tsx (source of truth
// has moved here; the main-thread component now uses the worker path and keeps
// only the fallback main-thread copy of these strings).
// ---------------------------------------------------------------------------

const MAX_RIPPLES = 5

const VERTEX_SHADER = /* glsl */ `
  uniform float uTime;
  uniform vec2 uRippleOrigins[${MAX_RIPPLES}];
  uniform float uRippleTimes[${MAX_RIPPLES}];
  uniform int uRippleCount;
  varying float vElevation;

  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec2 mod289v2(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }

  float snoise(vec2 v) {
    const vec4 C = vec4(
      0.211324865405187, 0.366025403784439,
     -0.577350269189626, 0.024390243902439
    );
    vec2 i  = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289v2(i);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
    m = m * m; m = m * m;
    vec3 x_ = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x_) - 0.5;
    vec3 ox = floor(x_ + 0.5);
    vec3 a0 = x_ - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
    vec3 g;
    g.x  = a0.x  * x0.x  + h.x  * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }

  void main() {
    vec3 pos = position;

    float n1 = snoise(vec2(pos.x * 0.35, pos.y * 0.35 + uTime * 0.12));
    float n2 = snoise(vec2(pos.x * 0.8 + 3.0, pos.y * 0.8 - uTime * 0.08));
    float elevation = n1 * 0.35 + n2 * 0.12;

    for (int i = 0; i < ${MAX_RIPPLES}; i++) {
      if (i >= uRippleCount) break;
      float age = uTime - uRippleTimes[i];
      if (age < 0.0 || age > 2.5) continue;

      float dist = distance(pos.xy, uRippleOrigins[i]);
      float radius = age * 3.0;
      float ringWidth = 1.2;
      float ring = exp(-pow((dist - radius) / ringWidth, 2.0));
      float fade = 1.0 - smoothstep(0.0, 2.5, age);
      float wave = sin(dist * 4.0 - age * 8.0) * ring * fade * 0.35;
      elevation += wave;
    }

    pos.z += elevation;
    vElevation = elevation;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`

const FRAGMENT_SHADER = /* glsl */ `
  varying float vElevation;
  void main() {
    vec3 baseColor = vec3(0.12, 0.12, 0.12);
    float t = smoothstep(-0.1, 0.4, vElevation);
    vec3 peakColor = vec3(0.149, 0.152, 0.163);
    vec3 color = mix(baseColor, peakColor, t);
    gl_FragColor = vec4(color, 1.0);
  }
`

// ---------------------------------------------------------------------------
// Message protocol types (main → worker discriminated union)
// ---------------------------------------------------------------------------

interface InitMsg {
  type: 'init'
  canvas: OffscreenCanvas
  width: number
  height: number
  dpr: number
  prefersReduced: boolean
  noRipples: boolean
}

interface ResizeMsg {
  type: 'resize'
  width: number
  height: number
  dpr: number
}

interface RippleMsg {
  type: 'ripple'
  ndcX: number
  ndcY: number
}

interface VisibilityMsg {
  type: 'visibility'
  hidden: boolean
}

interface DisposeMsg {
  type: 'dispose'
}

type WorkerMsg = InitMsg | ResizeMsg | RippleMsg | VisibilityMsg | DisposeMsg

// ---------------------------------------------------------------------------
// Worker state — populated on 'init'
// ---------------------------------------------------------------------------

let renderer: WebGLRenderer | null = null
let scene: Scene | null = null
let camera: PerspectiveCamera | null = null
let geometry: PlaneGeometry | null = null
let material: ShaderMaterial | null = null
let mesh: Mesh | null = null
let raycaster: Raycaster | null = null
let timer: Timer | null = null
let uniforms: {
  uTime: { value: number }
  uRippleOrigins: { value: Vector2[] }
  uRippleTimes: { value: Float32Array }
  uRippleCount: { value: number }
} | null = null

let rippleIndex = 0
let raf = 0
let isHidden = false
let lastFrameTs = 0

const FRAME_BUDGET_MS = 1000 / 40

// ---------------------------------------------------------------------------
// Tick loop
// ---------------------------------------------------------------------------

function tick(ts: number): void {
  if (
    renderer === null ||
    scene === null ||
    camera === null ||
    uniforms === null ||
    timer === null
  ) return

  raf = requestAnimationFrame(tick)

  if (isHidden) {
    // Page hidden — skip GPU work entirely. uTime freezes; no timer.update().
    return
  }

  if (ts - lastFrameTs >= FRAME_BUDGET_MS) {
    lastFrameTs = ts
    timer.update()
    uniforms.uTime.value = timer.getElapsed()
    renderer.render(scene, camera)
  }
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

self.onmessage = (e: MessageEvent<WorkerMsg>) => {
  const msg = e.data

  switch (msg.type) {

    case 'init': {
      // Build the renderer — if WebGL context creation fails, notify main
      // thread to fall back to the main-thread rendering path.
      try {
        renderer = new WebGLRenderer({
          canvas: msg.canvas as unknown as HTMLCanvasElement,
          antialias: false,
          alpha: false,
          depth: false,
          stencil: false,
          powerPreference: 'low-power',
          preserveDrawingBuffer: false,
        })
      } catch {
        self.postMessage({ type: 'fallback' })
        return
      }

      renderer.setClearColor(0x212121)
      const initDpr = Math.min(msg.dpr, 1.25)
      renderer.setPixelRatio(initDpr)
      renderer.setSize(Math.floor(msg.width * initDpr) / initDpr, Math.floor(msg.height * initDpr) / initDpr, false)

      scene = new Scene()
      camera = new PerspectiveCamera(45, msg.width / msg.height, 0.1, 100)
      camera.position.set(0, 0, 5)
      camera.lookAt(0, 0, 0)

      // 48×48 subdivisions — same reasoning as the main-thread version.
      geometry = new PlaneGeometry(12, 12, 48, 48)
      geometry.rotateZ(Math.PI)

      uniforms = {
        uTime: { value: 0 },
        uRippleOrigins: { value: Array.from({ length: MAX_RIPPLES }, () => new Vector2(0, 0)) },
        uRippleTimes: { value: new Float32Array(MAX_RIPPLES).fill(-10) },
        uRippleCount: { value: 0 },
      }

      material = new ShaderMaterial({
        vertexShader: VERTEX_SHADER,
        fragmentShader: FRAGMENT_SHADER,
        uniforms,
      })
      mesh = new Mesh(geometry, material)
      scene.add(mesh)

      raycaster = new Raycaster()
      timer = new Timer()

      if (msg.prefersReduced) {
        // Reduced-motion: render exactly one static frame and stop.
        uniforms.uTime.value = 0
        renderer.render(scene, camera)
        return
      }

      raf = requestAnimationFrame(tick)
      break
    }

    case 'resize': {
      if (!renderer || !camera) return
      const dpr = Math.min(msg.dpr, 1.25)
      renderer.setPixelRatio(dpr)
      // Math.floor on the DPR-scaled pixel buffer so rounding never produces
      // a buffer 1px wider/taller than the container, which would cause a
      // transient overflow scrollbar. `false` keeps CSS size at 100%/100%.
      renderer.setSize(Math.floor(msg.width * dpr) / dpr, Math.floor(msg.height * dpr) / dpr, false)
      camera.aspect = msg.width / msg.height
      camera.updateProjectionMatrix()

      // If reduced-motion, re-render one static frame at the new size.
      // We detect it implicitly: if tick was never started (raf===0 and timer
      // exists but the loop never ran), re-render. We use a simpler heuristic:
      // if raf is still 0 after init completed, we are in reduced-motion mode.
      if (raf === 0 && renderer && scene && camera && uniforms) {
        uniforms.uTime.value = 0
        renderer.render(scene, camera)
      }
      break
    }

    case 'ripple': {
      if (!raycaster || !camera || !mesh || !uniforms) return
      const pointer = new Vector2(msg.ndcX, msg.ndcY)
      raycaster.setFromCamera(pointer, camera)
      const hits = raycaster.intersectObject(mesh)
      if (hits.length > 0) {
        const p = hits[0].point
        const idx = rippleIndex % MAX_RIPPLES
        uniforms.uRippleOrigins.value[idx].set(p.x, p.y)
        uniforms.uRippleTimes.value[idx] = uniforms.uTime.value
        rippleIndex++
        uniforms.uRippleCount.value = Math.min(rippleIndex, MAX_RIPPLES)
      }
      break
    }

    case 'visibility': {
      isHidden = msg.hidden
      break
    }

    case 'dispose': {
      cancelAnimationFrame(raf)
      raf = 0
      geometry?.dispose()
      material?.dispose()
      renderer?.dispose()
      renderer = null
      scene = null
      camera = null
      geometry = null
      material = null
      mesh = null
      raycaster = null
      timer = null
      uniforms = null
      break
    }
  }
}
