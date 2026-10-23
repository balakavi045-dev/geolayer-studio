"""Real drawing/download interactions; external services are isolated with fixtures.

Run: python3 tests/browser_smoke.py
Requires Playwright and Chromium (already available in the cloud image).
This does not claim live OSRM, tile, or search availability.
"""
import json
import shutil
import threading
import unittest
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import sync_playwright


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


class StudioSmoke(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        directory = str(Path(__file__).resolve().parents[1])
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=directory))
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.playwright = sync_playwright().start()
        executable = shutil.which('chromium') or shutil.which('google-chrome')
        cls.browser = cls.playwright.chromium.launch(executable_path=executable, headless=True)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self):
        self.page = self.browser.new_page(viewport={'width': 1440, 'height': 1000}, accept_downloads=True)
        self.errors = []
        self.page.on('pageerror', lambda error: self.errors.append(str(error)))
        self.page.route('https://**/*', lambda route: route.abort())
        self.page.goto(f'http://127.0.0.1:{self.server.server_port}/', wait_until='networkidle')
        self.page.locator('.leaflet-draw-draw-marker').wait_for()

    def tearDown(self):
        errors = self.errors[:]
        self.page.close()
        self.assertEqual(errors, [])

    def map_click(self, x, y):
        box = self.page.locator('#map').bounding_box()
        self.page.mouse.click(box['x'] + x, box['y'] + y)
        # Leaflet.draw debounces new vertices for 50 ms to avoid duplicate touch events.
        self.page.wait_for_timeout(75)

    def download(self):
        with self.page.expect_download() as info:
            self.page.locator('#exportGeoJSON').click()
        download = info.value
        self.assertEqual(download.suggested_filename, 'geolayer-features.geojson')
        data = json.loads(Path(download.path()).read_text())
        self.assertEqual(data['type'], 'FeatureCollection')
        return data['features']

    def endpoints(self, start='13.0827, 80.2707', end='12.9716, 77.5946'):
        self.page.locator('#routeStart').fill(start)
        self.page.locator('#routeEnd').fill(end)

    def test_draw_all_shapes_and_download(self):
        self.page.locator('#featureName').fill('<img src=x onerror=alert(1)>')
        self.page.locator('.leaflet-draw-draw-marker').click()
        self.map_click(200, 250)
        self.page.locator('#featureName').fill('Test area')
        self.page.locator('.leaflet-draw-draw-polygon').click()
        for point in [(300, 180), (480, 180), (400, 330), (300, 180)]:
            self.map_click(*point)
        self.page.locator('.leaflet-draw-draw-polyline').click()
        for point in [(150, 450), (300, 480), (300, 480)]:
            self.map_click(*point)
        self.page.locator('.leaflet-draw-draw-rectangle').click()
        box = self.page.locator('#map').bounding_box()
        self.page.mouse.move(box['x'] + 500, box['y'] + 450)
        self.page.mouse.down()
        self.page.mouse.move(box['x'] + 650, box['y'] + 550, steps=8)
        self.page.mouse.up()
        features = self.download()
        self.assertEqual([f['geometry']['type'] for f in features], ['Point', 'Polygon', 'LineString', 'Polygon'])
        for feature in features:
            if feature['geometry']['type'] == 'Polygon':
                ring = feature['geometry']['coordinates'][0]
                self.assertEqual(ring[0], ring[-1])
                self.assertGreaterEqual(len(ring), 4)
        self.assertEqual(self.page.locator('#featureList img').count(), 0)
        self.assertEqual(features[0]['properties']['name'], '<img src=x onerror=alert(1)>')

    def test_edit_delete_and_empty_export(self):
        self.page.locator('#exportGeoJSON').click()
        self.assertIn('Draw a feature', self.page.locator('#notif').inner_text())
        self.page.locator('.leaflet-draw-draw-marker').click()
        self.map_click(300, 300)
        original = self.download()[0]['geometry']['coordinates']
        self.page.locator('.leaflet-draw-edit-edit').click()
        pin = self.page.locator('.drawing-pin').bounding_box()
        self.page.mouse.move(pin['x'] + 7, pin['y'] + 7)
        self.page.mouse.down()
        self.page.mouse.move(pin['x'] + 57, pin['y'] + 37, steps=8)
        self.page.mouse.up()
        self.page.locator('.leaflet-draw-actions a', has_text='Save').click()
        self.assertNotEqual(self.download()[0]['geometry']['coordinates'], original)
        self.page.locator('.feature-remove').click()
        self.assertEqual(self.page.locator('.feature-row').count(), 0)

    def test_flight_dateline_and_input_validation(self):
        self.page.locator('#routeMode').select_option('flight')
        self.endpoints('95, 0', '35, -170')
        self.page.locator('#buildRoute').click()
        self.assertIn('Latitude must', self.page.locator('#routeStatus').inner_text())
        self.assertEqual(self.page.locator('.feature-row').count(), 0)
        self.endpoints('35, 170', '35, -170')
        self.page.locator('#buildRoute').click()
        self.page.wait_for_function("document.querySelectorAll('.feature-row').length === 1")
        feature = self.download()[0]
        self.assertEqual(feature['geometry']['type'], 'MultiLineString')
        self.assertTrue(feature['properties']['estimated'])
        self.assertEqual(feature['properties']['transport'], 'airplane')

    def test_ship_manual_waypoints(self):
        self.page.locator('#routeMode').select_option('ship')
        self.assertFalse(self.page.locator('#routeStart').is_visible())
        self.page.locator('#featureName').fill('Harbour waypoints')
        self.page.locator('#buildRoute').click()
        for point in [(250, 250), (350, 280), (450, 350), (450, 350)]:
            self.map_click(*point)
        feature = self.download()[0]
        self.assertEqual(feature['geometry']['type'], 'LineString')
        self.assertEqual(len(feature['geometry']['coordinates']), 3)
        self.assertEqual(feature['properties']['transport'], 'ship')
        self.assertFalse(feature['properties']['navigation_safe'])

    def test_road_response_and_failure(self):
        fixture = {'code': 'Ok', 'routes': [{'geometry': {'type': 'LineString', 'coordinates': [[80.2707, 13.0827], [79, 13], [77.5946, 12.9716]]}, 'distance': 350000, 'duration': 21000}]}
        urls = []
        def respond(route):
            urls.append(route.request.url)
            route.fulfill(json=fixture)
        self.page.route('https://router.project-osrm.org/**', respond)
        self.endpoints()
        self.page.locator('#buildRoute').click()
        self.page.wait_for_function("document.querySelectorAll('.feature-row').length === 1")
        feature = self.download()[0]
        self.assertIn('/80.2707,13.0827;77.5946,12.9716?', urls[0])
        self.assertEqual(feature['geometry'], fixture['routes'][0]['geometry'])
        self.assertEqual(feature['properties']['source'], 'OpenStreetMap / OSRM')
        self.page.unroute('https://router.project-osrm.org/**', respond)
        self.page.locator('#buildRoute').click()
        self.page.wait_for_function("document.querySelector('#routeStatus').textContent.includes('Cannot reach')")
        self.assertEqual(self.page.locator('.feature-row').count(), 1)
        self.assertTrue(self.page.locator('#buildRoute').is_enabled())

    def test_pick_cancel_and_mobile_controls(self):
        self.page.set_viewport_size({'width': 390, 'height': 844})
        self.page.locator('#pickStart').click()
        self.map_click(100, 200)
        self.assertRegex(self.page.locator('#routeStart').input_value(), r'^-?\d+\.\d+, -?\d+\.\d+$')
        self.page.locator('#pickEnd').click()
        self.page.keyboard.press('Escape')
        self.map_click(120, 240)
        self.assertEqual(self.page.locator('#routeEnd').input_value(), '')
        self.assertTrue(self.page.locator('#exportGeoJSON').is_visible())
        self.assertGreater(self.page.locator('#map').bounding_box()['width'], 100)

    def test_camera_sequence_export_remains_available(self):
        self.page.locator('#labelName').fill('Chennai')
        self.page.locator('.add-seq-btn').click()
        with self.page.expect_download() as info:
            self.page.get_by_role('button', name='⬇ Export Sequence', exact=True).click()
        data = json.loads(Path(info.value.path()).read_text())
        self.assertEqual(len(data['keyframes']), 1)
        self.assertEqual(data['keyframes'][0]['name'], 'Chennai')


if __name__ == '__main__':
    unittest.main(verbosity=2)
