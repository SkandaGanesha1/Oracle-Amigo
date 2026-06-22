import React, { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

type UniformValue = number | number[] | number[][];

type UniformDefinition = {
  value: UniformValue;
  type: "uniform1f" | "uniform1i" | "uniform1fv" | "uniform2f" | "uniform3f" | "uniform3fv";
};

type Uniforms = Record<string, UniformDefinition>;

interface ShaderProps {
  source: string;
  uniforms: Uniforms;
  maxFps?: number;
}

interface CanvasRevealEffectProps {
  animationSpeed?: number;
  opacities?: number[];
  colors?: number[][];
  containerClassName?: string;
  dotSize?: number;
  showGradient?: boolean;
  reverse?: boolean;
}

interface DotMatrixProps {
  colors?: number[][];
  opacities?: number[];
  totalSize?: number;
  dotSize?: number;
  shader?: string;
  center?: ("x" | "y")[];
}

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function usePrefersReducedMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefersReducedMotion(query.matches);
    const onChange = () => setPrefersReducedMotion(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return prefersReducedMotion;
}

function useWebGLAvailable(): boolean {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    setAvailable(Boolean(context));
  }, []);

  return available;
}

function colorUniforms(colors: number[][]) {
  let colorsArray = [colors[0], colors[0], colors[0], colors[0], colors[0], colors[0]];
  if (colors.length === 2) {
    colorsArray = [colors[0], colors[0], colors[0], colors[1], colors[1], colors[1]];
  } else if (colors.length >= 3) {
    colorsArray = [colors[0], colors[0], colors[1], colors[1], colors[2], colors[2]];
  }

  return colorsArray.map((color) => [color[0] / 255, color[1] / 255, color[2] / 255]);
}

export function CanvasRevealEffect({
  animationSpeed = 3,
  opacities = [0.08, 0.1, 0.12, 0.16, 0.2, 0.26, 0.34, 0.44, 0.58, 0.72],
  colors = [[255, 255, 255], [255, 255, 255]],
  containerClassName,
  dotSize = 6,
  showGradient = true,
  reverse = false,
}: CanvasRevealEffectProps) {
  return (
    <div className={classNames("oa-canvas-reveal", containerClassName)}>
      <div className="oa-canvas-reveal-stage">
        <DotMatrix
          colors={colors}
          dotSize={dotSize}
          opacities={opacities}
          shader={`${reverse ? "u_reverse_active" : "false"}_; animation_speed_factor_${animationSpeed.toFixed(1)}_;`}
          center={["x", "y"]}
        />
      </div>
      {showGradient && <div className="oa-canvas-reveal-gradient" />}
    </div>
  );
}

export function DotMatrix({
  colors = [[255, 255, 255], [255, 255, 255]],
  opacities = [0.08, 0.1, 0.12, 0.16, 0.2, 0.26, 0.34, 0.44, 0.58, 0.72],
  totalSize = 20,
  dotSize = 6,
  shader = "",
  center = ["x", "y"],
}: DotMatrixProps) {
  if (opacities.length !== 10) {
    throw new Error("DotMatrix opacities must contain exactly 10 values.");
  }

  const speedMatch = shader.match(/animation_speed_factor_([0-9.]+)/);
  const animationSpeed = speedMatch ? Number(speedMatch[1]) : 3;

  const uniforms = useMemo<Uniforms>(() => ({
    u_colors: {
      value: colorUniforms(colors),
      type: "uniform3fv",
    },
    u_opacities: {
      value: opacities,
      type: "uniform1fv",
    },
    u_total_size: {
      value: totalSize,
      type: "uniform1f",
    },
    u_dot_size: {
      value: dotSize,
      type: "uniform1f",
    },
    u_reverse: {
      value: shader.includes("u_reverse_active") ? 1 : 0,
      type: "uniform1i",
    },
    u_animation_speed: {
      value: animationSpeed,
      type: "uniform1f",
    },
  }), [animationSpeed, colors, dotSize, opacities, shader, totalSize]);

  return (
    <Shader
      source={`
        precision mediump float;

        in vec2 fragCoord;
        uniform float u_time;
        uniform float u_opacities[10];
        uniform vec3 u_colors[6];
        uniform float u_total_size;
        uniform float u_dot_size;
        uniform float u_animation_speed;
        uniform vec2 u_resolution;
        uniform int u_reverse;
        out vec4 fragColor;

        float PHI = 1.61803398874989484820459;

        float random(vec2 xy) {
          return fract(tan(distance(xy * PHI, xy) * 0.5) * xy.x);
        }

        void main() {
          vec2 st = fragCoord.xy;
          ${center.includes("x") ? "st.x -= abs(floor((mod(u_resolution.x, u_total_size) - u_dot_size) * 0.5));" : ""}
          ${center.includes("y") ? "st.y -= abs(floor((mod(u_resolution.y, u_total_size) - u_dot_size) * 0.5));" : ""}

          float opacity = step(0.0, st.x);
          opacity *= step(0.0, st.y);

          vec2 st2 = vec2(int(st.x / u_total_size), int(st.y / u_total_size));
          float show_offset = random(st2);
          float rand = random(st2 * floor((u_time / 5.0) + show_offset + 5.0));

          opacity *= u_opacities[int(rand * 10.0)];
          opacity *= 1.0 - step(u_dot_size / u_total_size, fract(st.x / u_total_size));
          opacity *= 1.0 - step(u_dot_size / u_total_size, fract(st.y / u_total_size));

          vec3 color = u_colors[int(show_offset * 6.0)];
          vec2 center_grid = u_resolution / 2.0 / u_total_size;
          float dist_from_center = distance(center_grid, st2);
          float max_grid_dist = distance(center_grid, vec2(0.0, 0.0));
          float timing_offset_intro = dist_from_center * 0.01 + random(st2) * 0.15;
          float timing_offset_outro = (max_grid_dist - dist_from_center) * 0.02 + random(st2 + 42.0) * 0.2;
          float current_timing_offset = u_reverse == 1 ? timing_offset_outro : timing_offset_intro;
          float t = u_time * max(u_animation_speed, 0.1) * 0.5;

          if (u_reverse == 1) {
            opacity *= 1.0 - smoothstep(current_timing_offset, current_timing_offset + 0.18, t);
          } else {
            opacity *= smoothstep(current_timing_offset, current_timing_offset + 0.18, t);
          }

          fragColor = vec4(color, opacity);
          fragColor.rgb *= fragColor.a;
        }
      `}
      uniforms={uniforms}
      maxFps={60}
    />
  );
}

function prepareUniforms(uniforms: Uniforms, width: number, height: number) {
  const nextUniforms: Record<string, { value: unknown }> = {};

  for (const uniformName in uniforms) {
    const uniform = uniforms[uniformName];
    switch (uniform.type) {
      case "uniform1f":
      case "uniform1i":
      case "uniform1fv":
        nextUniforms[uniformName] = { value: uniform.value };
        break;
      case "uniform2f":
        nextUniforms[uniformName] = { value: new THREE.Vector2().fromArray(uniform.value as number[]) };
        break;
      case "uniform3f":
        nextUniforms[uniformName] = { value: new THREE.Vector3().fromArray(uniform.value as number[]) };
        break;
      case "uniform3fv":
        nextUniforms[uniformName] = {
          value: (uniform.value as number[][]).map((value) => new THREE.Vector3().fromArray(value)),
        };
        break;
    }
  }

  nextUniforms.u_time = { value: 0 };
  nextUniforms.u_resolution = { value: new THREE.Vector2(width * 2, height * 2) };
  return nextUniforms;
}

export function ShaderMaterial({ source, uniforms }: ShaderProps) {
  return new THREE.ShaderMaterial({
    vertexShader: `
      precision mediump float;
      uniform vec2 u_resolution;
      out vec2 fragCoord;

      void main() {
        gl_Position = vec4(position.xy, 0.0, 1.0);
        fragCoord = (position.xy + vec2(1.0)) * 0.5 * u_resolution;
        fragCoord.y = u_resolution.y - fragCoord.y;
      }
    `,
    fragmentShader: source,
    uniforms: prepareUniforms(uniforms, 1, 1),
    glslVersion: THREE.GLSL3,
    transparent: true,
    blending: THREE.CustomBlending,
    blendSrc: THREE.SrcAlphaFactor,
    blendDst: THREE.OneFactor,
    depthWrite: false,
  });
}

export function Shader({ source, uniforms, maxFps = 60 }: ShaderProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return;

    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: false,
      powerPreference: "low-power",
    });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const geometry = new THREE.PlaneGeometry(2, 2);
    const material = ShaderMaterial({ source, uniforms });
    const mesh = new THREE.Mesh(geometry, material);
    const timer = new THREE.Timer();
    let animationFrame = 0;
    let lastFrameTime = 0;

    timer.connect(document);
    scene.add(mesh);

    const setSize = () => {
      const { width, height } = parent.getBoundingClientRect();
      const nextWidth = Math.max(1, width);
      const nextHeight = Math.max(1, height);
      renderer.setSize(nextWidth, nextHeight, false);
      material.uniforms.u_resolution.value.set(nextWidth * 2, nextHeight * 2);
    };

    const resizeObserver = new ResizeObserver(setSize);
    resizeObserver.observe(parent);
    setSize();

    const render = (timestamp: number) => {
      animationFrame = window.requestAnimationFrame(render);
      timer.update(timestamp);
      const elapsed = timer.getElapsed();
      if (elapsed - lastFrameTime < 1 / maxFps) return;
      lastFrameTime = elapsed;
      material.uniforms.u_time.value = elapsed;
      renderer.render(scene, camera);
    };

    animationFrame = window.requestAnimationFrame(render);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      timer.dispose();
      geometry.dispose();
      material.dispose();
      renderer.dispose();
    };
  }, [maxFps, source, uniforms]);

  return (
    <div className="oa-auth-canvas">
      <canvas ref={canvasRef} />
    </div>
  );
}

export function AuthDotMatrixBackground() {
  const prefersReducedMotion = usePrefersReducedMotion();
  const webglAvailable = useWebGLAvailable();
  const showCanvas = webglAvailable && !prefersReducedMotion;

  return (
    <div className="oa-auth-bg" data-webgl={showCanvas ? "true" : "false"} aria-hidden="true">
      <div className="oa-auth-bg-fallback" />
      {showCanvas && (
        <CanvasRevealEffect
          animationSpeed={3}
          containerClassName="oa-auth-bg-webgl"
          colors={[[255, 255, 255], [255, 255, 255]]}
          dotSize={6}
          reverse={false}
        />
      )}
      <div className="oa-auth-bg-radial" />
      <div className="oa-auth-bg-topfade" />
    </div>
  );
}
