# Bundled map libraries

- Leaflet 1.9.4, BSD-2-Clause, from the `leaflet@1.9.4` npm package.
- Leaflet.draw 1.0.4, MIT, from the `leaflet-draw@1.0.4` npm package.

Distribution assets are copied unchanged. npm verified package integrity during
installation with lifecycle scripts disabled. Leaflet.draw's package omits the
license file; the included license comes from its upstream `v1.0.4` tag.
Library licenses are in the respective directories. `SHA256SUMS` records the
bundled file hashes (`sha256sum -c SHA256SUMS` from this directory).

Bundling keeps drawing and GeoJSON downloads available without a CDN. Basemap
tiles, fonts, place search, and OSRM road routing still require Internet access.
