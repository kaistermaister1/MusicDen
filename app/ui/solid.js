/* The 3D view of the stage: notes as lit solid blocks travelling down a lane toward a keyboard
   whose keys go down as they sound. One unit of the scene is the width of a white key; x runs
   along the keyboard, y is up, and the lane runs away from the viewer along -z from the line
   where notes land (z = 0). The keyboard sits in front of that line. */
import {S, clamp, isBlack, rgbf, mix} from './settings.js';
import {program, smoothTarget, dropTarget, NOISE} from './gl.js';
import {SPARK, DUST, PUFF} from './stage.js';

const KEY_LEN = 5.6, BLACK_LEN = 3.55, BLACK_RISE = 0.42, KEY_DEEP = 0.9, FRONT = 0.5;
const NOTE_HIGH = 0.3, SHARP_HIGH = 0.5, FOV_X = 38 * Math.PI / 180, MAX_LIGHTS = 20;
const IVORY = [0.985, 0.975, 0.925], EBONY = [0.085, 0.085, 0.09];

/* ---------- shaders ---------- */
/* A block with rounded corners and a bevelled top edge. One mesh serves every size: each vertex
   says which corner it belongs to, which way it leans out, and how far round the bevel it is. */
const BOX_VS = `#version 300 es
layout(location=0) in vec3 aS;
layout(location=1) in vec2 aD;
layout(location=2) in vec2 aPhi;
layout(location=3) in vec4 iCenter;
layout(location=4) in vec4 iHalf;
layout(location=5) in vec4 iColor;
layout(location=6) in vec4 iParam;
uniform mat4 uVP;
out vec3 vWorld; out vec3 vNormal; out vec3 vLocal; out vec3 vHalf; out vec4 vColor; out vec4 vParam;
void main() {
  float R = min(iHalf.w, min(iHalf.x, iHalf.z));
  float b = min(iParam.x, min(R, iHalf.y * 2.0));
  float top = step(0.0, aS.y);
  float rr = R - b * (1.0 - aPhi.x) * top;
  vec3 p = vec3(aS.x * (iHalf.x - R) + aD.x * rr, top > 0.5 ? iHalf.y - b * (1.0 - aPhi.y) : -iHalf.y, aS.z * (iHalf.z - R) + aD.y * rr);
  vLocal = p; vHalf = iHalf.xyz;
  /* a key that is down swings about its far end */
  p.y -= iCenter.w * (p.z + iHalf.z) / (2.0 * iHalf.z) * 0.36;
  vWorld = iCenter.xyz + p;
  vNormal = normalize(vec3(aD.x * aPhi.x, aPhi.y * top + 0.0001, aD.y * aPhi.x));
  vColor = iColor; vParam = iParam;
  gl_Position = uVP * vec4(vWorld, 1.0);
}`;
/* material: 0 matte note, 1 glossy note, 2 outlined note, 3 white key, 4 black key, 5 plain, 6 glowing */
const BOX_FS = `#version 300 es
precision highp float;
in vec3 vWorld; in vec3 vNormal; in vec3 vLocal; in vec3 vHalf; in vec4 vColor; in vec4 vParam;
uniform vec3 uEye; uniform vec3 uBg; uniform float uLane; uniform vec3 uEdge;
uniform int uLights; uniform vec3 uLightPos[${MAX_LIGHTS}]; uniform vec3 uLightCol[${MAX_LIGHTS}];
out vec4 o;
const vec3 KEY = vec3(-0.3754, 0.8496, 0.3705);
void main() {
  int mat = int(vParam.y + 0.5);
  if (mat <= 2 && vWorld.z > 0.0) discard;
  vec3 N = normalize(vNormal), V = normalize(uEye - vWorld), c = vColor.rgb;
  float a = vColor.a;
  float lit = clamp(dot(N, KEY) / KEY.y, 0.0, 1.0);
  float spec = pow(max(dot(N, normalize(KEY + V)), 0.0), 70.0);
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  vec3 col;
  if (mat <= 2) {
    if (mat == 0) col = c * (0.42 + 0.58 * lit);
    else if (mat == 1) col = c * (0.36 + 0.68 * lit) + vec3(spec) * 0.8 + mix(c, vec3(1.0), 0.6) * fres * 0.5 + c * c * 0.12;
    else {
      vec3 dd = vHalf - abs(vLocal);
      float lo = min(dd.x, min(dd.y, dd.z)), hi = max(dd.x, max(dd.y, dd.z)), mid = dd.x + dd.y + dd.z - lo - hi;
      float w = fwidth(mid) * 1.5 + 0.03;
      float edge = 1.0 - smoothstep(w * 0.5, w, mid);
      col = c; a *= max(edge, 0.17);
    }
    /* notes come out of the dark at the far end of the lane */
    col = mix(col, uBg, smoothstep(uLane * 0.88, uLane, -vWorld.z));
    o = vec4(col * a, a);
    return;
  }
  if (mat == 3 || mat == 4) {
    bool white = mat == 3;
    float pw = white ? 36.0 : 90.0;
    vec3 acc = c * (white ? 0.52 + 0.44 * lit : 0.35 + 0.65 * lit);
    /* shade where the keys meet the line the notes land on */
    acc *= mix(0.55, 1.0, smoothstep(0.0, 0.9, vWorld.z));
    vec3 sum = vec3(0.0), shine = vec3(0.0); float weight = 0.0;
    for (int i = 0; i < uLights; i++) {
      vec3 Lv = uLightPos[i] - vWorld; float d2 = dot(Lv, Lv); vec3 Ld = Lv * inversesqrt(d2);
      float power = max(uLightCol[i].r, max(uLightCol[i].g, uLightCol[i].b));
      float w = power / (1.0 + d2 * 0.42) * (max(dot(N, Ld), 0.0) * 0.85 + 0.15);
      sum += uLightCol[i] / max(power, 0.001) * w; weight += w;
      shine += uLightCol[i] * pow(max(dot(N, normalize(Ld + V)), 0.0), pw) / (1.0 + d2 * 0.2);
    }
    /* colored light from sounding notes pools on the keys, taking the place of the room's light */
    if (weight > 0.0) {
      vec3 tint = sum / weight;
      acc = white ? mix(acc, c * tint * 1.05, (1.0 - exp(-weight)) * 0.8) : acc + tint * (1.0 - exp(-weight)) * 0.10;
    }
    acc += (vec3(spec) * 0.5 + shine) * (white ? 0.3 : 0.85) + fres * (white ? 0.04 : 0.10);
    acc += uEdge * exp(-max(vWorld.z, 0.0) * 0.9) * (white ? 0.42 : 0.2) * (0.4 + 0.6 * N.y);
    acc += c * vParam.z * 0.1;
    o = vec4(acc, 0.0);
    return;
  }
  if (mat == 5) col = c * (0.45 + 0.55 * lit); else col = c;
  o = vec4(col, 0.0);
}`;

/* The lane the notes travel down: the background color, with guide lines and pools of light. */
const FLOOR_VS = `#version 300 es
layout(location=0) in vec2 aCorner;
uniform mat4 uVP; uniform vec4 uRect;
out vec3 vWorld;
void main() {
  vWorld = vec3(mix(uRect.x, uRect.z, aCorner.x), 0.0, mix(uRect.y, uRect.w, aCorner.y));
  gl_Position = uVP * vec4(vWorld, 1.0);
}`;
const FLOOR_FS = `#version 300 es
precision highp float;
in vec3 vWorld;
uniform vec3 uBg; uniform vec3 uEdge; uniform float uLane; uniform float uWide;
uniform int uLines; uniform vec2 uLine[24];
uniform int uLights; uniform vec3 uLightPos[${MAX_LIGHTS}]; uniform vec3 uLightCol[${MAX_LIGHTS}];
out vec4 o;
void main() {
  vec3 col = uBg;
  float px = fwidth(vWorld.x), far = -vWorld.z / uLane;
  float inside = step(0.0, vWorld.x) * step(vWorld.x, uWide) * step(0.0, far) * (1.0 - smoothstep(0.9, 1.0, far));
  for (int i = 0; i < uLines; i++) col += uLine[i].y * inside * clamp(1.0 - abs(vWorld.x - uLine[i].x) / px, 0.0, 1.0);
  for (int i = 0; i < uLights; i++) {
    vec3 Lv = uLightPos[i] - vWorld; float d2 = dot(Lv, Lv);
    col += uLightCol[i] * 0.34 / (1.0 + d2 * 1.1) * step(vWorld.z, 0.0);
  }
  col += uEdge * 0.5 * exp(vWorld.z * 1.7) * step(vWorld.z, 0.0);
  o = vec4(col, 0.0);
}`;

/* Flat marks lying on a surface: lettering, and soft shadows. mode: 0 lettering, 1 shadow, 2 shadow that stops at the landing line. */
const DECAL_VS = `#version 300 es
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 iPos;
layout(location=2) in vec4 iSize;
layout(location=3) in vec4 iColor;
uniform mat4 uVP;
out vec2 vUv; out vec2 vLocal; out vec4 vSize; out vec4 vColor; out float vMode; out float vZ;
void main() {
  vec2 l = (aCorner * 2.0 - 1.0) * iSize.xy;
  vec3 p = iPos.xyz + vec3(l.x, 0.0, l.y);
  vUv = aCorner; vLocal = l; vSize = iSize; vColor = iColor; vMode = iPos.w; vZ = p.z;
  gl_Position = uVP * vec4(p, 1.0);
}`;
const DECAL_FS = `#version 300 es
precision highp float;
in vec2 vUv; in vec2 vLocal; in vec4 vSize; in vec4 vColor; in float vMode; in float vZ;
uniform sampler2D uAtlas; uniform float uCells;
out vec4 o;
void main() {
  float k;
  if (vMode < 0.5) k = texture(uAtlas, vec2((vSize.z + vUv.x) / uCells, vUv.y)).a * vColor.a;
  else {
    if (vMode > 1.5 && vZ > 0.0) discard;
    float soft = vSize.w;
    vec2 q = abs(vLocal) - (vSize.xy - soft * 2.0) + vSize.z;
    float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - vSize.z;
    k = vColor.a * (1.0 - smoothstep(-soft, soft, d));
  }
  o = vec4(vColor.rgb * k, k);
}`;

/* Light that faces the viewer: sparks, dust, smoke, and the glow along the landing line. Haze and
   plumes stand upright on the lane instead. mode: 3 soft light, 4 spark, 5 haze, 6 plume, 8 light line, 10 smoke. */
const BILL_VS = `#version 300 es
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 iPos;
layout(location=2) in vec4 iSize;
layout(location=3) in vec4 iColor;
uniform mat4 uView; uniform mat4 uProj;
out vec2 vQ; out vec4 vColor; out vec4 vParam; out vec2 vPos;
void main() {
  vec2 l = (aCorner * 2.0 - 1.0) * iSize.xy * 0.5;
  vec4 c;
  if (iSize.z > 4.5 && iSize.z < 6.5) c = uView * vec4(iPos.xyz + vec3(l, 0.0), 1.0);
  else {
    float a = iPos.w;
    c = uView * vec4(iPos.xyz, 1.0);
    c.xy += vec2(l.x * cos(a) - l.y * sin(a), l.x * sin(a) + l.y * cos(a));
  }
  vQ = aCorner * 2.0 - 1.0; vColor = iColor; vParam = iSize; vPos = (iPos.xy + l) * 34.0;
  gl_Position = uProj * c;
}`;
const BILL_FS = `#version 300 es
precision highp float;
in vec2 vQ; in vec4 vColor; in vec4 vParam; in vec2 vPos;
uniform float uTime;
out vec4 o;
${NOISE}
void main() {
  int mode = int(vParam.z + 0.5);
  vec3 c = vColor.rgb; float a = vColor.a, g;
  vec2 q = vQ;
  if (mode == 3) g = exp(-dot(q, q) * 3.2) * smoothstep(1.05, 0.55, length(q));
  else if (mode == 4) g = exp(-dot(q, q) * 4.5);
  else if (mode == 8) g = exp(-q.y * q.y * 7.0);
  else if (mode == 5) {
    float h = clamp(0.5 - q.y * 0.5, 0.0, 1.0);
    vec2 uv = vPos * 0.0055;
    g = pow(h, 2.4) * (0.25 + 1.6 * fbm(vec2(uv.x * 1.2, uTime * 0.16 - uv.y * 1.7)) * fbm(vec2(uv.x * 2.6 + 4.0 - uTime * 0.05, uTime * 0.27 - uv.y * 2.3)));
  } else if (mode == 6) {
    float h = clamp(0.5 - q.y * 0.5, 0.0, 1.0);
    vec2 uv = vPos * 0.011;
    float sway = (fbm(vec2(uTime * 0.5 - uv.y * 1.1, vParam.w)) - 0.5) * 1.3 * (1.0 - h);
    float xx = q.x + sway;
    g = exp(-xx * xx * (2.5 + 9.0 * h * h)) * pow(h, 1.5) * (0.3 + 1.5 * fbm(vec2(uv.x * 1.6 + vParam.w, uTime * 0.7 - uv.y * 1.5))) * smoothstep(0.0, 0.12, h);
  } else {
    float n = fbm(vPos * 0.018 + vec2(vParam.w * 13.0, vParam.w * 5.0 - uTime * 0.22));
    float m = fbm(vPos * 0.045 - vec2(uTime * 0.1, vParam.w * 3.0));
    float f = smoothstep(1.0, 0.0, length(q));
    g = f * f * (0.2 + 1.5 * n * (0.5 + m));
  }
  o = vec4(c * g * a, 0.0);
}`;

/* ---------- small matrix helpers (column-major) ---------- */
function multiply(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
}

/* The rounded block: rings of points around its outline, from the bottom of the wall up over the bevel, and a cap. */
function blockMesh() {
  const K = 6, M = 4, verts = [], index = [], P = 4 * (K + 1);
  const ring = (sy, phi) => {
    for (let q = 0; q < 4; q++) for (let k = 0; k <= K; k++) {
      const th = (q + k / K) * Math.PI / 2;
      verts.push([1, -1, -1, 1][q], sy, [1, 1, -1, -1][q], Math.cos(th), Math.sin(th), Math.cos(phi), Math.sin(phi));
    }
  };
  ring(-1, 0);
  for (let j = 0; j <= M; j++) ring(1, j / M * Math.PI / 2);
  verts.push(0, 1, 0, 0, 0, 0, 1);
  const rings = M + 2, center = rings * P;
  for (let r = 0; r < rings - 1; r++) for (let i = 0; i < P; i++) {
    const a = r * P + i, b = r * P + (i + 1) % P, c = a + P, d = b + P;
    index.push(a, c, b, b, c, d);
  }
  for (let i = 0; i < P; i++) index.push(center, (rings - 1) * P + (i + 1) % P, (rings - 1) * P + i);
  return {verts: new Float32Array(verts), index: new Uint16Array(index)};
}

export class Solid {
  constructor(stage) {
    this.stage = stage; this.busy = false;
    const gl = this.gl = stage.gl;
    this.pBox = program(gl, BOX_VS, BOX_FS, ['uVP', 'uEye', 'uBg', 'uLane', 'uEdge', 'uLights', 'uLightPos', 'uLightCol']);
    this.pFloor = program(gl, FLOOR_VS, FLOOR_FS, ['uVP', 'uRect', 'uBg', 'uEdge', 'uLane', 'uWide', 'uLines', 'uLine', 'uLights', 'uLightPos', 'uLightCol']);
    this.pDecal = program(gl, DECAL_VS, DECAL_FS, ['uVP', 'uAtlas', 'uCells']);
    this.pBill = program(gl, BILL_VS, BILL_FS, ['uView', 'uProj', 'uTime']);

    const mesh = blockMesh();
    this.indexCount = mesh.index.length;
    this.boxVao = gl.createVertexArray(); gl.bindVertexArray(this.boxVao);
    const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, mesh.verts, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 28, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 28, 20);
    const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.index, gl.STATIC_DRAW);
    this.boxData = new Float32Array(6000 * 16); this.boxBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.boxBuf); gl.bufferData(gl.ARRAY_BUFFER, this.boxData.byteLength, gl.DYNAMIC_DRAW);
    for (let i = 0; i < 4; i++) { gl.enableVertexAttribArray(3 + i); gl.vertexAttribPointer(3 + i, 4, gl.FLOAT, false, 64, i * 16); gl.vertexAttribDivisor(3 + i, 1); }

    /* lettering, shadows and lights are all one rectangle per instance with three settings each */
    const rects = n => {
      const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, stage.corners);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      const data = new Float32Array(n * 12), buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, data.byteLength, gl.DYNAMIC_DRAW);
      for (let i = 0; i < 3; i++) { gl.enableVertexAttribArray(1 + i); gl.vertexAttribPointer(1 + i, 4, gl.FLOAT, false, 48, i * 16); gl.vertexAttribDivisor(1 + i, 1); }
      return {vao, data, buf, n: 0, max: n};
    };
    this.decals = rects(6000); this.bills = rects(9000);
    this.floorVao = gl.createVertexArray(); gl.bindVertexArray(this.floorVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, stage.corners);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    this.boxes = 0; this.press = new Float32Array(128);
    this.lightPos = new Float32Array(MAX_LIGHTS * 3); this.lightCol = new Float32Array(MAX_LIGHTS * 3); this.lineData = new Float32Array(48);
    this.smooth = null;
  }
  resize() {
    const gl = this.gl, st = this.stage;
    dropTarget(gl, this.smooth); this.smooth = null;
    if (st.pw) { try { this.smooth = smoothTarget(gl, st.pw, st.ph, st.deep); } catch (e) { this.smooth = smoothTarget(gl, st.pw, st.ph, false); } }
  }

  /* Places the camera: the front of the keyboard spans the bottom of the picture, and the lane
     runs to the top of it (or to a far limit when the view is tilted enough to see the horizon).
     Tall pictures get a narrower lens, so the lane is not stretched by a very wide upward view. */
  layout() {
    const st = this.stage, geo = st.geo;
    if (!geo) return;
    const wide = geo.whites.length, aspect = st.W / st.H;
    const ty = Math.min(Math.tan(FOV_X / 2) / aspect, 0.4), tx = ty * aspect, tilt = clamp(S.tilt, 0, 1) * 70 * Math.PI / 180;
    const reach = (st.H - geo.kbH) / geo.keyW * 3;
    const sin = Math.sin(tilt), cos = Math.cos(tilt);
    const d = [0, -cos, -sin], u = [0, sin, -cos];
    const dist = (wide / 2) / tx, F = [wide / 2, -0.3, KEY_LEN + FRONT];
    const eye = [F[0], F[1] - dist * d[1] + dist * ty * u[1], F[2] - dist * d[2] + dist * ty * u[2]];
    const room = cos - ty * sin;
    const lane = room > 0.02 ? Math.min(reach, eye[1] * (sin + ty * cos) / room - eye[2]) : reach;
    const near = 1, far = 900, f = 1 / ty;
    const proj = new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, 2 * far * near / (near - far), 0]);
    const dot = v => v[0] * eye[0] + v[1] * eye[1] + v[2] * eye[2];
    const view = new Float32Array([1, u[0], -d[0], 0, 0, u[1], -d[1], 0, 0, u[2], -d[2], 0, -eye[0], -dot(u), dot(d), 1]);
    this.eye = eye; this.view = view; this.proj = proj; this.vp = multiply(proj, view); this.lane = Math.max(8, lane); this.wide = wide;
    if (S.view === 'solid') geo.lane = this.lane * geo.keyW;
  }
  /* Where a point of the scene appears on the stage, in stage pixels. */
  project(x, y, z) {
    const m = this.vp, w = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (w <= 0) return null;
    return [((m[0] * x + m[4] * y + m[8] * z + m[12]) / w * 0.5 + 0.5) * this.stage.W, (0.5 - (m[1] * x + m[5] * y + m[9] * z + m[13]) / w * 0.5) * this.stage.H];
  }
  /* True when the stage point lies inside the four-sided shape with these corners in the scene. */
  inside(px, py, corners) {
    let sign = 0;
    const pts = corners.map(c => this.project(c[0], c[1], c[2]));
    if (pts.some(p => !p)) return false;
    for (let i = 0; i < 4; i++) {
      const a = pts[i], b = pts[(i + 1) % 4], cross = (b[0] - a[0]) * (py - a[1]) - (b[1] - a[1]) * (px - a[0]);
      if (cross !== 0) { if (sign && Math.sign(cross) !== sign) return false; sign = Math.sign(cross); }
    }
    return true;
  }
  /* A note's place in the scene: left edge, width, near and far end along the lane, and height. */
  noteSpan(i) {
    const st = this.stage, k = st.geo.keyW, list = st.list, midi = list[i];
    const near = Math.max(0, list[i + 1]) / k, far = list[i + 2] / k, [nx, nw] = st.noteBox(midi, 1e6), ref = st.refs[i / 5];
    /* notes sharing a key stand at slightly different heights, so where they overlap one is cleanly on top */
    return {x: nx / k, w: nw / k, near, far, high: (isBlack(midi) ? SHARP_HIGH : NOTE_HIGH) + (ref ? ref.track * 0.008 : 0.03)};
  }
  noteAt(px, py) {
    const st = this.stage, {list, refs} = st;
    for (const wantBlack of [true, false]) {
      for (let i = list.length - 5; i >= 0; i -= 5) {
        if (!refs[i / 5] || isBlack(list[i]) !== wantBlack) continue;
        const n = this.noteSpan(i);
        if (n.far <= n.near) continue;
        const far = Math.max(n.far, n.near + 0.35);
        if (this.inside(px, py, [[n.x, n.high, -n.near], [n.x + n.w, n.high, -n.near], [n.x + n.w, n.high, -far], [n.x, n.high, -far]])) return i;
      }
    }
    return -1;
  }
  keyAt(px, py) {
    const geo = this.stage.geo, k = geo.keyW;
    for (const m of geo.blacks) {
      const x0 = geo.x[m] / k, x1 = x0 + geo.w[m] / k;
      if (this.inside(px, py, [[x0, BLACK_RISE, 0], [x1, BLACK_RISE, 0], [x1, BLACK_RISE, BLACK_LEN], [x0, BLACK_RISE, BLACK_LEN]])) return m;
    }
    for (const m of geo.whites) {
      const x0 = geo.x[m] / k;
      if (this.inside(px, py, [[x0, 0, 0], [x0 + 1, 0, 0], [x0 + 1, -0.4, KEY_LEN + 0.2], [x0, -0.4, KEY_LEN + 0.2]])) return m;
    }
    return -1;
  }

  /* ---------- gathering shapes ---------- */
  box(cx, cy, cz, press, hx, hy, hz, r, c, a, bevel, material, glow) {
    if (this.boxes >= 6000) return;
    const d = this.boxData, o = this.boxes++ * 16;
    d[o] = cx; d[o + 1] = cy; d[o + 2] = cz; d[o + 3] = press;
    d[o + 4] = hx; d[o + 5] = hy; d[o + 6] = hz; d[o + 7] = r;
    d[o + 8] = c[0]; d[o + 9] = c[1]; d[o + 10] = c[2]; d[o + 11] = a;
    d[o + 12] = bevel; d[o + 13] = material; d[o + 14] = glow; d[o + 15] = 0;
  }
  rect(set, x, y, z, w, sx, sy, p, q, c, a) {
    if (set.n >= set.max) return;
    const d = set.data, o = set.n++ * 12;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = w;
    d[o + 4] = sx; d[o + 5] = sy; d[o + 6] = p; d[o + 7] = q;
    d[o + 8] = c[0]; d[o + 9] = c[1]; d[o + 10] = c[2]; d[o + 11] = a;
  }
  drawBoxes() {
    const gl = this.gl;
    if (!this.boxes) return;
    gl.bindVertexArray(this.boxVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.boxBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.boxData, 0, this.boxes * 16);
    gl.drawElementsInstanced(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_SHORT, 0, this.boxes);
    this.boxes = 0;
  }
  drawRects(set) {
    const gl = this.gl;
    if (!set.n) return;
    gl.bindVertexArray(set.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, set.buf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, set.data, 0, set.n * 12);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, set.n);
    set.n = 0;
  }

  /* The glow is gathered from a first drawing without the keyboard, so keys take its light without adding to it. */
  draw(clock) {
    if (S.glow > 0) { this.scene(clock, false); this.stage.bloom(); }
    this.scene(clock, true);
  }
  scene(clock, keys) {
    const gl = this.gl, st = this.stage, {geo, list, flares, parts, mood, lit} = st, k = geo.keyW, wide = this.wide, lane = this.lane;
    if (!this.smooth) this.resize();
    const bg = rgbf(S.bg), moodC = [mood[0] / 255, mood[1] / 255, mood[2] / 255];
    const edge = S.edgeLight ? moodC : [0, 0, 0];
    const centerOf = m => (geo.x[m] + geo.w[m] / 2) / k;

    /* each sounding note is a small lamp just above the line where it lands; louder notes burn brighter */
    let lights = 0;
    for (const f of flares) {
      if (lights >= MAX_LIGHTS) break;
      const c = rgbf(f.color), power = S.spill * 2 * (0.55 + 0.9 * f.vel) * (0.72 + 0.28 * Math.exp(-f.age * 3));
      this.lightPos.set([centerOf(f.midi), 0.45, -0.2], lights * 3);
      this.lightCol.set([c[0] * power, c[1] * power, c[2] * power], lights * 3);
      lights++;
    }
    let lines = 0;
    if (S.octaveLines) for (const m of geo.whites) {
      const pc = m % 12;
      if ((pc === 0 || pc === 5) && geo.x[m] > 0 && lines < 24) { this.lineData[lines * 2] = geo.x[m] / k; this.lineData[lines * 2 + 1] = pc === 0 ? 0.1 : 0.055; lines++; }
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.smooth.fb); gl.viewport(0, 0, st.pw, st.ph);
    gl.clearColor(bg[0], bg[1], bg[2], 0); gl.clearDepth(1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true); gl.disable(gl.BLEND);

    /* the lane */
    gl.useProgram(this.pFloor.p);
    gl.uniformMatrix4fv(this.pFloor.uVP, false, this.vp);
    gl.uniform4f(this.pFloor.uRect, -wide * 4, -lane * 1.6 - 40, wide * 5, 0);
    gl.uniform3fv(this.pFloor.uBg, bg); gl.uniform3fv(this.pFloor.uEdge, edge); gl.uniform1f(this.pFloor.uLane, lane); gl.uniform1f(this.pFloor.uWide, wide);
    gl.uniform1i(this.pFloor.uLines, lines); gl.uniform2fv(this.pFloor.uLine, this.lineData);
    gl.uniform1i(this.pFloor.uLights, lights); gl.uniform3fv(this.pFloor.uLightPos, this.lightPos); gl.uniform3fv(this.pFloor.uLightCol, this.lightCol);
    gl.bindVertexArray(this.floorVao); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    /* soft shadows the notes cast on the lane */
    const lettering = () => {
      gl.useProgram(this.pDecal.p);
      gl.uniformMatrix4fv(this.pDecal.uVP, false, this.vp);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, st.atlasTex); gl.uniform1i(this.pDecal.uAtlas, 0); gl.uniform1f(this.pDecal.uCells, 21);
      gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE); gl.depthMask(false);
      this.drawRects(this.decals);
      gl.depthMask(true); gl.disable(gl.BLEND);
    };
    const black = [0, 0, 0];
    for (let i = 0; i < list.length; i += 5) {
      const n = this.noteSpan(i);
      if (n.far <= n.near) continue;
      const fade = 1 - clamp((n.near / lane - 0.8) / 0.2, 0, 1);
      this.rect(this.decals, n.x + n.w / 2 + 0.07, 0.004, -(n.near + n.far) / 2 + 0.05, 2, n.w / 2 + 0.16, (n.far - n.near) / 2 + 0.16, 0.12, 0.13, black, (list[i + 4] ? 0.1 : 0.34) * fade);
    }
    lettering();

    /* the keyboard: a dark bed, white keys, the shadows of the black keys, then the black keys */
    const boxes = () => {
      gl.useProgram(this.pBox.p);
      gl.uniformMatrix4fv(this.pBox.uVP, false, this.vp);
      gl.uniform3fv(this.pBox.uEye, this.eye); gl.uniform3fv(this.pBox.uBg, bg); gl.uniform1f(this.pBox.uLane, lane); gl.uniform3fv(this.pBox.uEdge, edge);
      gl.uniform1i(this.pBox.uLights, lights); gl.uniform3fv(this.pBox.uLightPos, this.lightPos); gl.uniform3fv(this.pBox.uLightCol, this.lightCol);
      this.drawBoxes();
    };
    if (keys) {
      const dt = st.dt || 0.016, ease = 1 - Math.exp(-dt * 38);
      let moving = false;
      for (let m = geo.lo; m <= geo.hi; m++) {
        const aim = lit[m] ? 1 : 0;
        this.press[m] += (aim - this.press[m]) * ease;
        if (Math.abs(aim - this.press[m]) > 0.004) moving = true; else this.press[m] = aim;
      }
      this.busy = moving;
      this.box(wide / 2, -KEY_DEEP - 0.25, KEY_LEN / 2 + 0.1, 0, wide / 2 + 0.3, 0.45, KEY_LEN / 2 + 0.35, 0.05, [0.02, 0.02, 0.022], 1, 0.02, 5, 0);
      for (const m of geo.whites) {
        const color = S.keyLight && lit[m] ? rgbf(mix(lit[m], '#ffffff', 0.12)) : IVORY;
        this.box(geo.x[m] / k + 0.5, -KEY_DEEP / 2, KEY_LEN / 2, this.press[m], 0.5 - 0.022, KEY_DEEP / 2, KEY_LEN / 2, 0.055, color, 1, 0.035, 3, S.keyLight && lit[m] ? 1 : 0);
      }
    }
    if (S.edgeLight) this.box(wide / 2, 0.012, -0.035, 0, wide / 2, 0.022, 0.05, 0.02, [(mood[0] * 0.45 + 140) / 255, (mood[1] * 0.45 + 140) / 255, (mood[2] * 0.45 + 140) / 255], 1, 0.01, 6, 0);
    else if (keys) this.box(wide / 2, 0.02, -0.1, 0, wide / 2, 0.045, 0.13, 0.03, [0.37, 0.05, 0.063], 1, 0.03, 5, 0);
    boxes();
    for (const m of keys ? geo.blacks : []) {
      const x0 = geo.x[m] / k, bw = geo.w[m] / k, down = this.press[m] * 0.2;
      this.rect(this.decals, x0 + bw / 2 + 0.1, 0.004, BLACK_LEN / 2 + 0.1, 1, bw / 2 + 0.22 - down, BLACK_LEN / 2 + 0.26 - down, 0.1, 0.16, black, 0.42);
    }
    if (S.octaveLabels && keys) {
      const ink = [0.553, 0.545, 0.494];
      for (const m of geo.whites) if (m % 12 === 0) this.rect(this.decals, geo.x[m] / k + 0.5, 0.006 - this.press[m] * 0.3, KEY_LEN - 0.75, 0, 0.62, 0.36, 12 + m / 12 - 1, 0, lit[m] && S.keyLight ? black : ink, lit[m] && S.keyLight ? 0.45 : 1);
    }
    lettering();
    for (const m of keys ? geo.blacks : []) {
      const color = S.keyLight && lit[m] ? rgbf(mix(lit[m], '#000000', 0.25)) : EBONY, bw = geo.w[m] / k;
      this.box(geo.x[m] / k + bw / 2, (BLACK_RISE - KEY_DEEP * 0.6) / 2, BLACK_LEN / 2, this.press[m] * 0.8, bw / 2, (BLACK_RISE + KEY_DEEP * 0.6) / 2, BLACK_LEN / 2, 0.07, color, 1, 0.07, 4, S.keyLight && lit[m] ? 1 : 0);
    }
    boxes();

    /* the notes */
    const material = S.shape === 'outline' ? 2 : S.finish === 'gloss' ? 1 : 0;
    for (const wantBlack of [false, true]) {
      for (let i = 0; i < list.length; i += 5) {
        if (isBlack(list[i]) !== wantBlack) continue;
        const n = this.noteSpan(i), len = list[i + 2] / k - Math.min(list[i + 1] / k, list[i + 2] / k);
        if (list[i + 2] <= list[i + 1] || n.far <= 0) continue;
        const z0 = list[i + 1] / k, z1 = list[i + 2] / k, quiet = list[i + 4];
        const r = Math.min(S.shape === 'pill' ? n.w / 2 : Math.min(n.w * 0.17, 9 / k), len / 2, n.w / 2);
        const bevel = S.shape === 'pill' ? 0.11 : material === 1 ? 0.075 : 0.05;
        this.box(n.x + n.w / 2, n.high / 2, -(z0 + z1) / 2, 0, n.w / 2 - 0.012, n.high / 2, (z1 - z0) / 2, r, rgbf(list[i + 3]), quiet ? 0.3 : 1, bevel, quiet && material === 1 ? 0 : material, 0);
        /* the note under the pointer, while changing hands, wears a white outline */
        if (st.hover === i) this.box(n.x + n.w / 2, n.high / 2 + 0.03, -(z0 + z1) / 2, 0, n.w / 2 + 0.05, n.high / 2 + 0.03, (z1 - z0) / 2 + 0.06, r + 0.05, [1, 1, 1], 1, bevel, 2, 0);
      }
    }
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    boxes();
    gl.disable(gl.BLEND);
    if (S.noteNames) {
      /* names in the chosen color; the lettering fills about a quarter of its cell, so the cell is one and a half to three notes wide */
      const ink = S.nameColor === 'white' ? [1, 1, 1] : [8 / 255, 8 / 255, 10 / 255], big = 1.5 + 1.5 * S.nameSize;
      for (let i = 0; i < list.length; i += 5) {
        const n = this.noteSpan(i), wide = n.w * big, deep = wide * 0.58;
        if (n.w < 0.4 || n.far - n.near < deep + 0.2) continue;
        const at = S.motion === 'fall' ? n.near + deep / 2 + 0.12 : n.far - deep / 2 - 0.12;
        this.rect(this.decals, n.x + n.w / 2, n.high + 0.004, -at, 0, wide, deep, list[i] % 12, 0, S.shape === 'outline' ? rgbf(list[i + 3]) : ink, (S.shape === 'outline' ? 1 : 0.92) * (list[i + 4] ? 0.3 : 1));
      }
      gl.useProgram(this.pDecal.p);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
      gl.uniformMatrix4fv(this.pDecal.uVP, false, this.vp);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, st.atlasTex); gl.uniform1i(this.pDecal.uAtlas, 0); gl.uniform1f(this.pDecal.uCells, 21);
      this.drawRects(this.decals);
      gl.depthMask(true); gl.disable(gl.BLEND);
    }

    /* light: first what must never tint a note (kept off them by the note mask), then sparks and dust */
    const v = this.view, white = [1, 1, 1], lum = Math.min(1, S.glow * 1.6);
    const bills = masked => {
      gl.useProgram(this.pBill.p);
      gl.uniformMatrix4fv(this.pBill.uView, false, this.view); gl.uniformMatrix4fv(this.pBill.uProj, false, this.proj); gl.uniform1f(this.pBill.uTime, clock % 3600);
      gl.enable(gl.BLEND); gl.depthMask(false);
      if (masked) gl.blendFuncSeparate(gl.ONE_MINUS_DST_ALPHA, gl.ONE, gl.ZERO, gl.ONE); else gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE);
      this.drawRects(this.bills);
      gl.depthMask(true); gl.disable(gl.BLEND);
    };
    const B = this.bills;
    if (S.haze) this.rect(B, wide / 2, 3.2, -0.4, 0, wide + 80, 6.4, 5, 0, moodC, 0.4);
    for (const f of flares) {
      const cx = centerOf(f.midi), c = rgbf(f.color), heat = 0.6 + 0.8 * f.vel;
      if (S.haze) this.rect(B, cx, 4, -0.5, 0, 5, 8, 6, f.midi * 1.37, c, 0.38 * heat);
      if (lum > 0) { this.rect(B, cx, 0.35, -0.3, 0, 4.4, 4.4, 3, 0, c, 0.42 * lum * heat); this.rect(B, cx, 0.3, -0.25, 0, 1.8, 1.8, 3, 0, white, 0.14 * lum); }
    }
    for (const p of parts) {
      if (p.kind !== PUFF) continue;
      const u = p.age / p.life, rad = p.size * (1 + u * 1.7) / k;
      this.rect(B, p.x / k, p.y / k + 0.2, -p.z / k - 0.3, 0, rad * 2, rad * 2, 10, p.seed, rgbf(p.color), 0.17 * p.heat * Math.sin(Math.PI * Math.pow(u, 0.6)));
    }
    if (S.edgeLight) {
      this.rect(B, wide / 2, 0.06, -0.02, 0, wide + 2, 0.5, 8, 0, moodC, 0.9);
      for (const f of flares) {
        const cx = centerOf(f.midi);
        this.rect(B, cx, 0.08, -0.03, 0, 6.4, 0.36, 3, 0, rgbf(f.color), 0.8);
        this.rect(B, cx, 0.08, -0.03, 0, 1.8, 0.24, 3, 0, white, 0.45);
      }
    }
    bills(true);
    for (const p of parts) {
      const c = rgbf(p.color), x = p.x / k, y = p.y / k + 0.05, z = -p.z / k - 0.05;
      if (p.kind === SPARK) {
        /* a spark is drawn stretched along the way it is moving, as seen from the camera */
        const vx = p.vx, vy = v[1] * p.vx + v[5] * p.vy - v[9] * p.vz, speed = Math.hypot(p.vx, p.vy, p.vz);
        this.rect(B, x, y, z, Math.atan2(vy, vx), clamp(speed * 0.04, 4, 30) / k, (p.size * 1.5 + 1.5) / k, 4, 0, c, (1 - p.age / p.life) * 2.4);
      } else if (p.kind === DUST) {
        const sz = p.size * 3.4 / k, u = p.age / p.life;
        this.rect(B, x, y, z, 0, sz, sz, 4, 0, c, Math.min(1, u * 9) * Math.pow(1 - u, 1.3) * (0.62 + 0.38 * Math.sin(p.seed + p.age * 9)) * 2);
      }
    }
    bills(false);

    gl.disable(gl.DEPTH_TEST); gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.smooth.fb); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, st.scene.fb);
    gl.blitFramebuffer(0, 0, st.pw, st.ph, 0, 0, st.pw, st.ph, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
}
