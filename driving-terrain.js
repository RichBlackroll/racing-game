// Four contact samples let the chassis follow both road grade and banking.
export function sampleDrivingSurface(heightAt, x, z, heading) {
  const fx = Math.sin(heading), fz = Math.cos(heading), rx = fz, rz = -fx;
  const front = heightAt(x + fx * 1.45, z + fz * 1.45);
  const rear = heightAt(x - fx * 1.45, z - fz * 1.45);
  const right = heightAt(x + rx * .85, z + rz * .85);
  const left = heightAt(x - rx * .85, z - rz * .85);
  return {
    height: (front + rear + right + left) / 4,
    pitch: Math.atan2(front - rear, 2.9),
    roll: Math.atan2(right - left, 1.7),
    grade: (front - rear) / 2.9,
  };
}
