/* Shaders and small helpers for drawing on the graphics card. */

export function program(gl, vs, fs, names) {
  const make = (type, src) => {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src); gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) + '\n' + src);
    return sh;
  };
  const p = gl.createProgram();
  gl.attachShader(p, make(gl.VERTEX_SHADER, vs)); gl.attachShader(p, make(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const out = {p};
  for (const n of names) out[n] = gl.getUniformLocation(p, n);
  return out;
}

/* A texture that can be drawn into. `deep` keeps light brighter than white. */
export function target(gl, w, h, deep, nearest) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, deep ? gl.RGBA16F : gl.RGBA8, w, h, 0, gl.RGBA, deep ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, null);
  const f = nearest ? gl.NEAREST : gl.LINEAR;
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, f], [gl.TEXTURE_MAG_FILTER, f], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('target');
  return {tex, fb, w, h};
}
export function dropTarget(gl, t) {
  if (!t) return;
  gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb);
  if (t.rb) for (const r of t.rb) gl.deleteRenderbuffer(r);
}
/* A smoothed drawing surface with depth, for scenes with real geometry. Resolved into a plain target to be read. */
export function smoothTarget(gl, w, h, deep) {
  const fmt = deep ? gl.RGBA16F : gl.RGBA8;
  const most = Math.max(0, ...(gl.getInternalformatParameter(gl.RENDERBUFFER, fmt, gl.SAMPLES) || [0]));
  const samples = Math.min(4, most);
  const fb = gl.createFramebuffer(), color = gl.createRenderbuffer(), depth = gl.createRenderbuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.bindRenderbuffer(gl.RENDERBUFFER, color);
  gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, fmt, w, h);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, color);
  gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
  gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT24, w, h);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('target');
  return {fb, w, h, rb: [color, depth], tex: null};
}

const NOISE = `
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(17.0, 9.0); a *= 0.5; } return s; }
`;

/* ---------- flat shapes: one rectangle per instance, in stage pixels ---------- */
export const QUAD_VS = `#version 300 es
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 aRect;
layout(location=2) in vec4 aColor;
layout(location=3) in vec4 aParam;
uniform vec2 uRes;
out vec2 vLocal; out vec2 vHalf; out vec4 vColor; out vec4 vParam; out vec2 vPos;
void main() {
  vec2 hs = aRect.zw * 0.5;
  vec2 l = (aCorner * 2.0 - 1.0) * (hs + 1.5);
  float a = aParam.z;
  vec2 p = aRect.xy + hs + vec2(l.x * cos(a) - l.y * sin(a), l.x * sin(a) + l.y * cos(a));
  vLocal = l; vHalf = hs; vColor = aColor; vParam = aParam; vPos = p;
  gl_Position = vec4(p.x / uRes.x * 2.0 - 1.0, 1.0 - p.y / uRes.y * 2.0, 0.0, 1.0);
}`;
/* mode: 0 flat, 1 glossy, 2 outline, 3 soft light, 4 spark, 5 haze, 6 plume, 7 plain line, 8 light line,
   9 lettering, 10 smoke, 11 wash fading downward, 12 pool of light fading outward, 13 ring. */
export const QUAD_FS = `#version 300 es
precision highp float;
in vec2 vLocal; in vec2 vHalf; in vec4 vColor; in vec4 vParam; in vec2 vPos;
uniform float uDpr; uniform float uTime; uniform sampler2D uAtlas; uniform float uCells;
out vec4 o;
float box(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
${NOISE}
void main() {
  int mode = int(vParam.y + 0.5);
  vec3 c = vColor.rgb; float a = vColor.a;
  vec2 q = vLocal / max(vHalf, vec2(0.001));
  if (mode <= 2 || mode == 7 || mode == 13) {
    float d = box(vLocal, vHalf, vParam.x);
    float cover = clamp(0.5 - d * uDpr, 0.0, 1.0);
    if (mode == 0) {
      o = vec4(c, 1.0) * cover * a;
    } else if (mode == 7) {
      o = vec4(c * cover * a, 0.0);
    } else if (mode == 2 || mode == 13) {
      float lw = vParam.w;
      float ring = clamp(0.5 - (abs(d + lw * 0.5) - lw * 0.5) * uDpr, 0.0, 1.0);
      float k = max(ring, mode == 2 ? cover * 0.17 : 0.0) * a;
      o = vec4(c * k, k);
    } else {
      float bevel = max(2.0, min(vHalf.x, vHalf.y) * vParam.w);
      float e = 0.6;
      vec2 gr = vec2(box(vLocal + vec2(e, 0.0), vHalf, vParam.x) - box(vLocal - vec2(e, 0.0), vHalf, vParam.x),
                     box(vLocal + vec2(0.0, e), vHalf, vParam.x) - box(vLocal - vec2(0.0, e), vHalf, vParam.x)) / (2.0 * e);
      float tt = clamp(-d / bevel, 0.0, 1.0);
      float lift = sqrt(max(0.0, 1.0 - (1.0 - tt) * (1.0 - tt)));
      vec3 n = normalize(vec3(gr * (1.0 - tt) * 1.15, lift + 0.08));
      vec3 L = normalize(vec3(-0.5, -0.62, 0.6));
      float ndl = max(dot(n, L), 0.0);
      float spec = pow(max(dot(n, normalize(L + vec3(0.0, 0.0, 1.0))), 0.0), 60.0);
      float rim = pow(1.0 - n.z, 2.4);
      float back = pow(max(dot(n, normalize(vec3(0.55, 0.7, 0.35))), 0.0), 2.0);
      vec3 col = c * (0.36 + 0.78 * ndl) + c * c * 0.22 * tt + mix(c, vec3(1.0), 0.55) * rim * 0.5 + c * back * 0.3 + vec3(spec) * 1.1;
      o = vec4(col, 1.0) * cover * a;
    }
  } else if (mode == 3) {
    float g = exp(-dot(q, q) * 3.2) * smoothstep(1.05, 0.55, length(q));
    o = vec4(c * g * a, 0.0);
  } else if (mode == 4) {
    o = vec4(c * exp(-dot(q, q) * 4.5) * a, 0.0);
  } else if (mode == 5) {
    float h = clamp(q.y * 0.5 + 0.5, 0.0, 1.0);
    vec2 uv = vPos * 0.0055;
    float n1 = fbm(vec2(uv.x * 1.2, uv.y * 1.7 + uTime * 0.16));
    float n2 = fbm(vec2(uv.x * 2.6 + 4.0 - uTime * 0.05, uv.y * 2.3 + uTime * 0.27));
    o = vec4(c * pow(h, 2.4) * (0.25 + 1.6 * n1 * n2) * a, 0.0);
  } else if (mode == 6) {
    float h = clamp(q.y * 0.5 + 0.5, 0.0, 1.0);
    vec2 uv = vPos * 0.011;
    float sway = (fbm(vec2(uv.y * 1.1 + uTime * 0.5, vParam.w)) - 0.5) * 1.3 * (1.0 - h);
    float xx = q.x + sway;
    float core = exp(-xx * xx * (2.5 + 9.0 * h * h));
    float n = fbm(vec2(uv.x * 1.6 + vParam.w, uv.y * 1.5 + uTime * 0.7));
    o = vec4(c * core * pow(h, 1.5) * (0.3 + 1.5 * n) * smoothstep(0.0, 0.12, h) * a, 0.0);
  } else if (mode == 8) {
    o = vec4(c * exp(-q.y * q.y * 7.0) * a, 0.0);
  } else if (mode == 9) {
    vec2 uv = clamp(q * 0.5 + 0.5, 0.0, 1.0);
    float k = texture(uAtlas, vec2((vParam.x + uv.x) / uCells, uv.y)).a * a * step(abs(q.x), 1.0) * step(abs(q.y), 1.0);
    o = vec4(c * k, k);
  } else if (mode == 10) {
    float r = length(q);
    float n = fbm(vPos * 0.018 + vec2(vParam.w * 13.0, uTime * 0.22 + vParam.w * 5.0));
    float m = fbm(vPos * 0.045 - vec2(uTime * 0.1, vParam.w * 3.0));
    float g = smoothstep(1.0, 0.0, r);
    o = vec4(c * g * g * (0.2 + 1.5 * n * (0.5 + m)) * a, 0.0);
  } else if (mode == 11) {
    float k = a * clamp(0.5 - q.y * 0.5, 0.0, 1.0) * step(abs(q.x), 1.0) * step(abs(q.y), 1.0);
    o = vec4(c * k, k);
  } else {
    float k = a * clamp(1.0 - length(q), 0.0, 1.0);
    o = vec4(c * k, k);
  }
}`;

/* ---------- full-frame passes ---------- */
export const POST_VS = `#version 300 es
out vec2 vUv;
void main() { vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); vUv = p; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;
const POST_HEAD = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uTex;
`;
/* Keeps only what gives off light: anything brighter than the background, plus a share of each note. */
export const PRE_FS = POST_HEAD + `uniform vec3 uBg; uniform float uNote;
void main() { vec4 s = texture(uTex, vUv); o = vec4(mix(max(s.rgb - uBg, 0.0), s.rgb * uNote, s.a), 1.0); }`;
export const DOWN_FS = POST_HEAD + `uniform vec2 uTexel;
void main() {
  vec3 s = texture(uTex, vUv).rgb * 4.0;
  s += texture(uTex, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture(uTex, vUv + uTexel * vec2(1.0, -1.0)).rgb;
  s += texture(uTex, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture(uTex, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  o = vec4(s / 8.0, 1.0);
}`;
export const UP_FS = POST_HEAD + `uniform vec2 uTexel;
void main() {
  vec2 t = uTexel * 0.5;
  vec3 s = texture(uTex, vUv + vec2(-2.0, 0.0) * t).rgb + texture(uTex, vUv + vec2(2.0, 0.0) * t).rgb;
  s += texture(uTex, vUv + vec2(0.0, 2.0) * t).rgb + texture(uTex, vUv + vec2(0.0, -2.0) * t).rgb;
  s += 2.0 * (texture(uTex, vUv + vec2(-1.0, 1.0) * t).rgb + texture(uTex, vUv + vec2(1.0, 1.0) * t).rgb);
  s += 2.0 * (texture(uTex, vUv + vec2(1.0, -1.0) * t).rgb + texture(uTex, vUv + vec2(-1.0, -1.0) * t).rgb);
  o = vec4(s / 12.0, 1.0);
}`;
/* The glow is added around notes, never on top of them, so a note keeps its exact color. */
export const FINAL_FS = POST_HEAD + `uniform sampler2D uBloom; uniform float uStrength; uniform float uGrain;
void main() {
  vec4 s = texture(uTex, vUv);
  vec3 c = s.rgb;
  float open = 1.0 - clamp(s.a, 0.0, 1.0);
  if (uStrength > 0.0) c += texture(uBloom, vUv).rgb * uStrength * open;
  /* a grain finer than one step of brightness keeps soft light from showing bands */
  c += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0 * open * uGrain;
  o = vec4(c, 1.0);
}`;
/* Draws a picture into a rectangle given in stage pixels; the picture's first row is its top. */
export const IMAGE_VS = `#version 300 es
layout(location=0) in vec2 aCorner;
uniform vec4 uRect; uniform vec2 uRes;
out vec2 vUv;
void main() {
  vec2 p = uRect.xy + aCorner * uRect.zw;
  vUv = aCorner;
  gl_Position = vec4(p.x / uRes.x * 2.0 - 1.0, 1.0 - p.y / uRes.y * 2.0, 0.0, 1.0);
}`;
export const IMAGE_FS = POST_HEAD + `void main() { o = vec4(texture(uTex, vUv).rgb, 0.0); }`;
/* Packs a finished frame for the video encoder: brightness for every pixel, then color at half size
   (NV12, BT.709), rows from the top of the picture down. */
export const PACK_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex; uniform ivec2 uSize;
out vec4 o;
vec3 at(int x, int y) { return texelFetch(uTex, ivec2(x, uSize.y - 1 - y), 0).rgb; }
float luma(vec3 c) { return (16.0 + 219.0 * dot(c, vec3(0.2126, 0.7152, 0.0722))) / 255.0; }
vec2 chroma(int cx, int row) {
  vec3 c = (at(cx * 2, row * 2) + at(cx * 2 + 1, row * 2) + at(cx * 2, row * 2 + 1) + at(cx * 2 + 1, row * 2 + 1)) * 0.25;
  return vec2(128.0 + 224.0 * dot(c, vec3(-0.1146, -0.3854, 0.5)), 128.0 + 224.0 * dot(c, vec3(0.5, -0.4542, -0.0458))) / 255.0;
}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  if (p.y < uSize.y) {
    int x = p.x * 4;
    o = vec4(luma(at(x, p.y)), luma(at(x + 1, p.y)), luma(at(x + 2, p.y)), luma(at(x + 3, p.y)));
  } else {
    int row = p.y - uSize.y;
    o = vec4(chroma(p.x * 2, row), chroma(p.x * 2 + 1, row));
  }
}`;
export {NOISE};
