struct Uniforms {
  viewProjectionMatrix: mat4x4<f32>,
};

struct InstanceInput {
  @location(1) position: vec3<f32>,
  @location(2) color: vec4<f32>,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct VertexOutput {
  @builtin(position) clip_position: vec4<f32>,
  @location(0) color: vec4<f32>,
};

@vertex
fn vs_main(
  @location(0) pos: vec3<f32>,
  instance: InstanceInput,
) -> VertexOutput {
  let worldPos = pos + instance.position;

  var out: VertexOutput;
  out.clip_position = uniforms.viewProjectionMatrix * vec4<f32>(worldPos, 1.0);
  out.color = instance.color;
  return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
  return in.color;
}