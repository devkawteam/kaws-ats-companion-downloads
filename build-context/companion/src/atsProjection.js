// Exact ATS world -> WGS84 conversion.
// ATS lays its map out on a Lambert conformal conic projection. The parameters come from the game's
// own def/climate.sii (map_projection: lambert_conic, standard paralels 33/45, map origin 39N 96W,
// map factor -0.00017706234 / 0.000176689948). This is a standard spherical LCC inverse written from
// those constants, so a truck position is exact from the first second, with no calibration needed.
// Input: telemetry world X and Z (the game's Y is height and is ignored).

const R = 6370997; // sphere radius; it cancels out, any value works
const DEG = Math.PI / 180;
const LENGTH_OF_DEGREE = (R * Math.PI) / 180;
const LAT1 = 33 * DEG, LAT2 = 45 * DEG, LAT0 = 39 * DEG, LON0 = -96 * DEG;
const FACTOR_Z = -0.00017706234, FACTOR_X = 0.000176689948;

const t = (lat) => Math.tan(Math.PI / 4 + lat / 2);
const n = Math.log(Math.cos(LAT1) / Math.cos(LAT2)) / Math.log(t(LAT2) / t(LAT1));
const F = (Math.cos(LAT1) * Math.pow(t(LAT1), n)) / n;
const rho0 = (R * F) / Math.pow(t(LAT0), n);

function atsToLonLat(x, z) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  const e = x * FACTOR_X * LENGTH_OF_DEGREE; // easting (m)
  const nn = z * FACTOR_Z * LENGTH_OF_DEGREE; // northing (m)
  const dy = rho0 - nn;
  let rho = Math.sign(n) * Math.hypot(e, dy);
  const theta = Math.atan2(Math.sign(n) * e, Math.sign(n) * dy);
  if (rho === 0) return { lon: LON0 / DEG, lat: Math.sign(n) * 90 };
  const lat = 2 * Math.atan(Math.pow((R * F) / rho, 1 / n)) - Math.PI / 2;
  const lon = LON0 + theta / n;
  return { lon: lon / DEG, lat: lat / DEG };
}

module.exports = { atsToLonLat };
