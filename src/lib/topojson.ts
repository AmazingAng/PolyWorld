/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Minimal TopoJSON -> GeoJSON converter for world-atlas topology.
 * Pure data transformation — no React dependency.
 */
export function topojsonFeature(topology: any, object: any) {
  const arcs = topology.arcs;
  const transform = topology.transform;

  function decodeArc(arcIndex: number): [number, number][] {
    const arc = arcs[arcIndex < 0 ? ~arcIndex : arcIndex];
    const coords: [number, number][] = [];
    let x = 0,
      y = 0;
    for (const point of arc) {
      x += point[0];
      y += point[1];
      coords.push([
        transform ? x * transform.scale[0] + transform.translate[0] : x,
        transform ? y * transform.scale[1] + transform.translate[1] : y,
      ]);
    }
    if (arcIndex < 0) coords.reverse();
    return coords;
  }

  function decodeRing(indices: number[]): [number, number][] {
    const ring: [number, number][] = [];
    for (const idx of indices) {
      const arc = decodeArc(idx);
      for (let i = ring.length > 0 ? 1 : 0; i < arc.length; i++) {
        ring.push(arc[i]);
      }
    }
    return ring;
  }

  function geometry(obj: any): any {
    if (obj.type === "GeometryCollection") {
      return { type: "GeometryCollection", geometries: obj.geometries.map(geometry) };
    }
    if (obj.type === "Polygon") {
      return { type: "Polygon", coordinates: obj.arcs.map(decodeRing) };
    }
    if (obj.type === "MultiPolygon") {
      return {
        type: "MultiPolygon",
        coordinates: obj.arcs.map((polygon: number[][]) => polygon.map(decodeRing)),
      };
    }
    return obj;
  }

  const features = object.geometries.map(
    (geom: any) => ({
      type: "Feature",
      properties: geom.properties || { name: geom.id },
      geometry: geometry(geom),
    })
  );

  return {
    type: "FeatureCollection" as const,
    features: features.flatMap(fixAntimeridianFeature),
  };
}

/** Split features whose polygon rings cross the antimeridian (+-180 longitude). */
export function fixAntimeridianFeature(feature: any): any[] {
  const geom = feature.geometry;
  if (geom.type === "Polygon") {
    const split = splitPolygonRings(geom.coordinates);
    if (split.length === 1) return [feature];
    return split.map((coords) => ({
      ...feature,
      geometry: { type: "Polygon", coordinates: coords },
    }));
  }
  if (geom.type === "MultiPolygon") {
    const allPolygons: [number, number][][][] = [];
    for (const poly of geom.coordinates) {
      const split = splitPolygonRings(poly);
      allPolygons.push(...split);
    }
    return [
      {
        ...feature,
        geometry: { type: "MultiPolygon", coordinates: allPolygons },
      },
    ];
  }
  return [feature];
}

/** Check if a ring actually spans the antimeridian (has points in both >160 and <-160). */
function ringsSpanAntimeridian(rings: [number, number][][]): boolean {
  const outer = rings[0];
  if (!outer) return false;
  let hasEast = false, hasWest = false;
  for (const [lng] of outer) {
    if (lng > 160) hasEast = true;
    if (lng < -160) hasWest = true;
    if (hasEast && hasWest) return true;
  }
  return false;
}

/**
 * Split polygon rings that cross the antimeridian into separate east/west polygons.
 * Uses segment-walking to preserve vertex ordering.
 */
export function splitPolygonRings(
  rings: [number, number][][]
): [number, number][][][] {
  const outer = rings[0];
  if (!outer || outer.length < 4) return [rings];
  if (!ringsSpanAntimeridian(rings)) return [rings];

  let crosses = false;
  for (let i = 1; i < outer.length; i++) {
    if (Math.abs(outer[i][0] - outer[i - 1][0]) > 180) {
      crosses = true;
      break;
    }
  }
  if (!crosses) return [rings];

  const eastSegments: [number, number][][] = [];
  const westSegments: [number, number][][] = [];

  let currentSide: "east" | "west" = outer[0][0] >= 0 ? "east" : "west";
  let currentSegment: [number, number][] = [outer[0]];

  for (let i = 1; i < outer.length; i++) {
    const prev = outer[i - 1];
    const curr = outer[i];

    if (Math.abs(curr[0] - prev[0]) > 180) {
      const sign = prev[0] > 0 ? 1 : -1;
      const currAdj = curr[0] + sign * 360;
      const denominator = currAdj - prev[0];
      const crossLat = Math.abs(denominator) < 0.01
        ? (prev[1] + curr[1]) / 2
        : prev[1] + ((sign * 180 - prev[0]) / denominator) * (curr[1] - prev[1]);

      currentSegment.push([sign * 180, crossLat]);
      if (currentSide === "east") eastSegments.push(currentSegment);
      else westSegments.push(currentSegment);

      currentSide = currentSide === "east" ? "west" : "east";
      currentSegment = [[-sign * 180, crossLat], curr];
    } else {
      currentSegment.push(curr);
    }
  }

  if (currentSegment.length > 0) {
    if (currentSide === "east") eastSegments.push(currentSegment);
    else westSegments.push(currentSegment);
  }

  const result: [number, number][][][] = [];
  for (const segments of [eastSegments, westSegments]) {
    if (segments.length === 0) continue;
    const ring = segments.flat();
    if (ring.length >= 3) {
      const first = ring[0], last = ring[ring.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) ring.push(ring[0]);
      result.push([ring]);
    }
  }

  return result.length > 0 ? result : [rings];
}
