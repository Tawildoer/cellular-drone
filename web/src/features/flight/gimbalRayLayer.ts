import { MercatorCoordinate, type CustomLayerInterface, type CustomRenderMethodInput, type Map as MaplibreMap } from 'maplibre-gl'
import type { GeoPoint } from '../../domain'

/** A point in the air: where it is and its height above sea level, as the
 * map's terrain measures it. */
export interface AirPoint {
  point: GeoPoint
  elevationM: number
}

export interface GimbalRaySegment {
  from: AirPoint
  to: AirPoint
}

export interface GimbalRayLayer extends CustomLayerInterface {
  /** Null hides the line. */
  setSegment(segment: GimbalRaySegment | null): void
  setOpacity(opacity: number): void
}

const VERTEX_SHADER = `#version 300 es
in vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`

const FRAGMENT_SHADER = `#version 300 es
precision mediump float;
uniform vec4 u_color;
out vec4 fragColor;
void main() {
  fragColor = u_color;
}`

/** Clip-space w below this is at or behind the camera. */
const NEAR_W = 1e-6

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  return shader
}

type Clip = [number, number, number, number]

/** A column-major 4×4 matrix times (x, y, z, 1). */
export function transform(m: ArrayLike<number>, x: number, y: number, z: number): Clip {
  const e = (i: number) => m[i] ?? 0
  return [
    e(0) * x + e(4) * y + e(8) * z + e(12),
    e(1) * x + e(5) * y + e(9) * z + e(13),
    e(2) * x + e(6) * y + e(10) * z + e(14),
    e(3) * x + e(7) * y + e(11) * z + e(15),
  ]
}

/**
 * The gimbal's line of sight as one smooth, straight 3D line of fixed pixel
 * width: MapLibre's line layers have no altitude, and stacking extrusions
 * made it a staircase. Both ends are projected on the CPU in double
 * precision each frame (just two points), then widened into a quad in
 * screen space, so the GPU never sees large mercator coordinates.
 * Mercator projection only, which is all the flight map uses. Hidden below
 * `minZoom`, where the flat overlays take over. Drawn without
 * depth testing, like the flat overlays: it never hides behind a hill.
 */
export function createGimbalRayLayer(
  id: string,
  map: MaplibreMap,
  options: { widthPx: number; color: [number, number, number]; opacity: number; minZoom: number },
): GimbalRayLayer {
  const { widthPx, color, minZoom } = options
  let program: WebGLProgram | null = null
  let buffer: WebGLBuffer | null = null
  let aPos = -1
  let uColor: WebGLUniformLocation | null = null
  let segment: GimbalRaySegment | null = null
  let opacity = options.opacity

  return {
    id,
    type: 'custom',
    renderingMode: '3d',

    onAdd(_map, gl) {
      const gl2 = gl as WebGL2RenderingContext
      program = gl2.createProgram()!
      gl2.attachShader(program, compile(gl2, gl2.VERTEX_SHADER, VERTEX_SHADER))
      gl2.attachShader(program, compile(gl2, gl2.FRAGMENT_SHADER, FRAGMENT_SHADER))
      gl2.linkProgram(program)
      aPos = gl2.getAttribLocation(program, 'a_pos')
      uColor = gl2.getUniformLocation(program, 'u_color')
      buffer = gl2.createBuffer()
    },

    onRemove(_map, gl) {
      if (program) gl.deleteProgram(program)
      if (buffer) gl.deleteBuffer(buffer)
      program = null
      buffer = null
    },

    setSegment(next) {
      segment = next
      map.triggerRepaint()
    },

    setOpacity(next) {
      opacity = next
      map.triggerRepaint()
    },

    render(gl, args: CustomRenderMethodInput) {
      // Zoomed out, the flat line stands in (FLAT_OVERLAY_MAX_ZOOM).
      if (!segment || !program || !buffer || opacity <= 0 || map.getZoom() < minZoom) return
      // Projects mercator 0..1 coordinates, z in mercator units too.
      const m = args.defaultProjectionData.mainMatrix
      const toClip = ({ point, elevationM }: AirPoint): Clip => {
        const c = MercatorCoordinate.fromLngLat([point.lon, point.lat], elevationM)
        return transform(m, c.x, c.y, c.z)
      }
      let a = toClip(segment.from)
      let b = toClip(segment.to)
      // Clip the segment to the near plane so an end behind the camera
      // doesn't flip through infinity.
      if (a[3] < NEAR_W && b[3] < NEAR_W) return
      if (a[3] < NEAR_W || b[3] < NEAR_W) {
        const [inside, outside] = a[3] >= NEAR_W ? [a, b] : [b, a]
        const t = (inside[3] - NEAR_W) / (inside[3] - outside[3])
        const cut: Clip = [0, 1, 2, 3].map((i) => inside[i]! + (outside[i]! - inside[i]!) * t) as Clip
        ;[a, b] = a[3] >= NEAR_W ? [a, cut] : [cut, b]
      }

      const w = gl.drawingBufferWidth
      const h = gl.drawingBufferHeight
      // To pixels, widen perpendicular to the line, back to NDC.
      const ax = (a[0] / a[3]) * 0.5 * w
      const ay = (a[1] / a[3]) * 0.5 * h
      const bx = (b[0] / b[3]) * 0.5 * w
      const by = (b[1] / b[3]) * 0.5 * h
      const len = Math.hypot(bx - ax, by - ay)
      const half = (widthPx * map.getPixelRatio()) / 2
      // Seen end-on (looking straight along it) it's a dot of the same width.
      const [nx, ny] = len < 1e-3 ? [half, 0] : [(-(by - ay) / len) * half, ((bx - ax) / len) * half]
      const [ux, uy] = len < 1e-3 ? [0, half] : [0, 0]
      const toNdc = (x: number, y: number) => [x / (0.5 * w), y / (0.5 * h)]
      const verts = new Float32Array([
        ...toNdc(ax + nx - ux, ay + ny - uy),
        ...toNdc(ax - nx - ux, ay - ny - uy),
        ...toNdc(bx + nx + ux, by + ny + uy),
        ...toNdc(bx - nx + ux, by - ny + uy),
      ])

      gl.useProgram(program)
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
      gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW)
      gl.enableVertexAttribArray(aPos)
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)
      gl.uniform4f(uColor, color[0], color[1], color[2], opacity)
      gl.disable(gl.DEPTH_TEST)
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    },
  }
}
