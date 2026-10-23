# GeoLayer Studio

A static Leaflet map editor with GeoJSON drawing and route export, alongside the
existing documentary camera sequence tools.

## Run

From this checkout:

```sh
python3 -m http.server 8000 --bind 0.0.0.0
```

No build, package installation, API key, or backend is required. Leaflet 1.9.4
and Leaflet.draw 1.0.4 are bundled with their licenses in `vendor/`.
Map tiles, fonts, place search, and road routing require Internet access.

## Draw and export

1. Optionally enter a name under **Draw & Export**.
2. Use the map toolbar to draw a line, polygon, rectangle, or point. Click the
   last point again to finish a line, or the first point to close a polygon.
3. Use the edit/delete toolbar and **Save** to commit changes to drawings.
4. Click **Export GeoJSON** to download all drawings and routes as a GeoJSON
   `FeatureCollection`, with coordinates in `[longitude, latitude]` order.

The feature list can focus or remove individual features. Road and estimated
flight routes are removed through this list; edit tools apply to drawings and
manual ship routes. Keep downloaded files: features exist in memory and are
cleared when the page is reloaded. **Export Sequence** separately exports camera
keyframes as JSON.

## Route sources

- **Car:** enter start/end as `latitude, longitude`, or use **Pick** to choose
  them on the map. **Create road route** requests a road-following path from the
  public OSRM demo server using OpenStreetMap data. It has no live traffic or
  availability guarantee; production use needs a supported routing service or
  your own OSRM instance. Disconnected roads return an error without adding a
  feature.
- **Airplane:** uses an estimated great-circle path. This is not a recorded
  flight, airline route, or air traffic clearance. Dateline crossings export as
  a `MultiLineString` so the path does not wrap across the map.
- **Ship:** draw manual waypoints on the water. No maritime routing, depth,
  coastline, or obstacle checking is performed. These lines are not for
  navigation.

Exports include each feature's name, source, transport mode where applicable,
and whether the geometry is estimated. Computed route distances are in metres;
OSRM duration is in seconds. These features do not extract Google Maps data.
Google's routing API has no flight or shipping mode.

## Checks

```sh
node --test tests/geometry.test.js
python3 tests/browser_smoke.py
```

The first command requires Node.js 18 or later. The browser checks require
Python, Playwright, and Chromium; they are supplied in the Codex cloud image.
They launch an isolated temporary HTTP server and exercise real map drawing,
editing, deleting, downloading, route inputs, and mobile controls. They use
fixtures for OSRM and block external tile/font requests, so they do not prove
live routing or basemap availability. Test live service access separately.

For the restricted cloud network, allow `router.project-osrm.org`,
`nominatim.openstreetmap.org`, `a.basemaps.cartocdn.com`,
`b.basemaps.cartocdn.com`, `c.basemaps.cartocdn.com`,
`server.arcgisonline.com`, `a.tile.opentopomap.org`,
`b.tile.opentopomap.org`, `c.tile.opentopomap.org`, `fonts.googleapis.com`, and
`fonts.gstatic.com`. Use the environment's supplied HTTPS trust configuration;
do not disable certificate verification.
