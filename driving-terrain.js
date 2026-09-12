// Four contact samples let the chassis follow both road grade and banking.
export function sampleDrivingSurface(heightAt, x, z, heading, { wheelbase = 2.9, track = 1.7 } = {}) {
  const fx = Math.sin(heading), fz = Math.cos(heading), rx = fz, rz = -fx;
  const front = heightAt(x + fx * (wheelbase / 2), z + fz * (wheelbase / 2));
  const rear = heightAt(x - fx * (wheelbase / 2), z - fz * (wheelbase / 2));
  const right = heightAt(x + rx * (track / 2), z + rz * (track / 2));
  const left = heightAt(x - rx * (track / 2), z - rz * (track / 2));
  return {
    height: (front + rear + right + left) / 4,
    pitch: Math.atan2(front - rear, wheelbase),
    roll: Math.atan2(right - left, track),
    grade: (front - rear) / wheelbase,
  };
}
