import json
from pathlib import Path
import struct
import sys
import threading
import unittest
from xml.etree import ElementTree as ET
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'research/python'))
from noteful import FormatError, decode_sample_strokes, parse, values, semantic_summary
from render_note import (TAPE_OPEN, composite, image_crop, path_geometry, render,
                         stroke_svg, tape_group, variable_ink)
from viewer import Handler, LocalServer


class ViewerTests(unittest.TestCase):
    def test_exam_complete_streams_and_pages(self):
        data = (ROOT / 'samples/Examen wuolah.noteful').read_bytes()
        report = parse(data)
        flags = []
        for block in report['blocks']:
            self.assertNotIn('stroke_decode_error', block)
            if 'strokes' not in block:
                continue
            strokes = block['strokes']
            blob = bytes.fromhex(values(block['fields'])[2]['hex'])
            # Account for every byte, including style commands between strokes.
            cursor = 0
            for s in strokes:
                while cursor < s['offset_in_blob']:
                    self.assertEqual(blob[cursor:cursor+2], b'\xf1\x02')
                    cursor += 44
                self.assertEqual(cursor, s['offset_in_blob'])
                cursor += s['size']
                flags.append(s['flags'])
            self.assertEqual(cursor, len(blob))
        self.assertEqual(len(flags), 2008)
        self.assertEqual(flags.count(1), 23)
        self.assertEqual(flags.count(2), 12)
        doc = render(data)
        self.assertEqual([p['stroke_count'] for p in doc['pages']], [621, 939, 448])
        self.assertEqual(doc['object_count'], 74)
        self.assertIn('data:image/jpeg;base64,', doc['pages'][1]['svg'])

    def test_all_exam_figures_are_rendered(self):
        doc = render((ROOT / 'samples/Examen wuolah.noteful').read_bytes())
        roots = [ET.fromstring(p['svg']) for p in doc['pages']]
        ns = {'s': 'http://www.w3.org/2000/svg'}
        self.assertEqual([p['warnings'] for p in doc['pages']], [[], [], []])
        self.assertEqual(sum(len(r.findall('.//s:ellipse', ns)) for r in roots), 5)
        paths = [p.get('d') for r in roots for p in r.findall('.//s:path', ns)]
        self.assertEqual(sum('C' in p for p in paths), 3)
        self.assertEqual(sum('Z' in p for p in paths), 3)
        self.assertTrue(any(r.get('rx') == '3.00000' for root in roots for r in root.findall('.//s:rect', ns)))

    def test_photo_highlighter_preserves_multiply_and_alpha(self):
        data = (ROOT / 'samples/Examen wuolah.noteful').read_bytes()
        summary = semantic_summary(parse(data))
        page_id = summary['pages'][1]['stroke_object_set_id']
        objects = [o for o in summary['objects'] if o['stroke_object_set_id'] == page_id]
        photo, = [o for o in objects if o['type_raw'] == 1]
        # The first highlighted line on page 2 lies inside the placed photograph.
        marker = min((o for o in objects if o['type_raw'] == 20 and o['tool_raw'] == 1), key=lambda o:o['transform_raw'][1])
        mx, my, *_ = marker['transform_raw']
        px, py, pw, ph, _ = photo['transform_raw']
        self.assertTrue(px-pw/2 < mx < px+pw/2 and py-ph/2 < my < py+ph/2)
        self.assertGreater(marker['z_order_raw'], photo['z_order_raw'])
        geometry = values(values(marker['payload_fields'])[13])
        d = path_geometry(geometry[1], geometry[2])
        root = ET.fromstring(render(data)['pages'][1]['svg'])
        parents = {child:parent for parent in root.iter() for child in parent}
        path, = [p for p in root.iter('{http://www.w3.org/2000/svg}path') if p.get('d') == d]
        self.assertEqual(path.get('stroke-width'), '28.00000')
        ancestors = []
        while path in parents:
            path = parents[path]
            ancestors.append(path)
        self.assertTrue(any(p.get('opacity') == '0.50000' and p.get('style') == 'mix-blend-mode:multiply' for p in ancestors))
        # Object opacity combines once with the highlighter's opacity.
        group = ET.fromstring(composite('<path/>', .4, 1))
        self.assertEqual(group.get('opacity'), '0.20000')

    def test_shape_paths_reject_incomplete_or_unknown_geometry(self):
        for coords, commands in (([1,2,3], [0,1]), ([1,2,3], [0]), ([1,2], [99])):
            with self.assertRaises(FormatError):
                path_geometry(coords, commands)
        self.assertEqual(path_geometry([0,0,1,2,3,4,5,6], [0,3]), 'M0.00000 0.00000 C1.00000 2.00000 3.00000 4.00000 5.00000 6.00000')

    def test_variable_radius_matches_independent_pdf_caps(self):
        report = parse((ROOT / 'samples/Examen wuolah.noteful').read_bytes())
        strokes = {s['id_raw']:s for b in report['blocks'] for s in b.get('strokes', [])}
        evidence = json.loads((ROOT / 'research/evidence/variable-width-validation.json').read_text())
        self.assertEqual(len(evidence['strokes']), 23)
        for row in evidence['strokes']:
            radius = strokes[row['stroke_id']]['radii'][0]
            for expected in row['pdf_cap_radii']:
                self.assertLess(abs(radius-expected), .001)
        xml = ET.fromstring(composite(variable_ink([[0,0],[10,0]], [1,3], [1,1,0,1]), 1, 1))
        self.assertEqual(xml.get('opacity'), '0.50000')
        self.assertEqual([c.get('r') for c in xml.iter('circle')], ['1.00000','3.00000'])
        self.assertEqual(len(list(xml.iter('polygon'))), 1)
        self.assertEqual(sum('opacity' in c.attrib for c in xml.iter()), 1)

    def test_style_raw_points_and_auxiliary_channel(self):
        style = b'\xf1\x02' + struct.pack('>ddddH', 1, 0, 0, .5, 1) + bytes(8)
        header = bytearray(38)
        struct.pack_into('>H', header, 8, 3)
        stroke = b'\xf1\x01' + header + struct.pack('>dII', 2, 0, 2)
        stroke += bytes(range(16)) + struct.pack('>ffffff', 10, 20, .25, 30, 40, .75)
        s, = decode_sample_strokes(style + stroke)
        self.assertEqual(s['candidate_points'], [[10,20],[30,40]])
        self.assertEqual(s['pressure_candidate'], [.25,.75])
        self.assertEqual(s['auxiliary_hex'], bytes(range(16)).hex())
        self.assertEqual(s['style']['rgba'], [1,0,0,.5])
        self.assertEqual(s['style']['tool_raw'], 1)

    def test_eraser_tape_and_crop_render_semantics(self):
        stroke = {
            "candidate_points": [[0., 0.], [10., 0.], [20., 0.]],
            "radii": [],
            "flags": 2,
            "point_count": 3,
            "auxiliary_hex": (struct.pack(">II", 0, 2)
                              + struct.pack(">ffff", 0, 0, .25, .5)).hex(),
            "thickness_candidate": 2.,
            "style": {"rgba": [0., 0., 0., 1.], "tool_raw": 0, "extra_hex": "00" * 8},
        }
        svg = stroke_svg(stroke, 4)
        self.assertEqual(svg.count("<polyline"), 2)
        self.assertIn("10.00000,0.00000", svg)
        self.assertIn("17.50000,0.00000", svg)
        stroke["style"]["tool_raw"] = 2
        stroke["flags"] = 6
        taped = stroke_svg(stroke, 4)
        self.assertIn(f'data-tape="stroke:4" data-revealed="1" opacity="{TAPE_OPEN:.5f}"', taped)
        self.assertIn('class="nc-tape-pattern"', taped)
        self.assertEqual(tape_group('<rect/>', 'object:1', False),
                         '<g data-tape="object:1" data-revealed="0" opacity="1.00000"><rect/></g>')
        p = {12: {1: [0., 183., 546., 183., 546., 391., 0., 391.],
                  2: [0, 1, 1, 1, 4]}}
        crop = image_crop(p, 1092., 416., 546., 632.)
        self.assertEqual((crop['left'], crop['top'], crop['width'], crop['height']),
                         (0., -366., 1092., 1264.))
        self.assertEqual(crop['outline'], 'M0.00000 0.00000 L1092.00000 0.00000 '
                                          'L1092.00000 416.00000 L0.00000 416.00000 Z')
        self.assertIsNone(image_crop({}, 10., 10., 10., 10.))

    def test_tape_and_tag_objects_keep_their_owner_note_semantics(self):
        tape = {"id": "T", "type_raw": 3, "kind_in_samples": "rounded_rectangle",
                "stroke_object_set_id": None,
                "transform_raw": [100., 100., 200., 40., 0.], "size": [200., 40.],
                "payload_fields": [
                    {"tag": 1, "type": "0x0002", "value": 3},
                    {"tag": 2, "type": "0x0821", "value": [200., 40.]},
                    {"tag": 13, "type": "0x0807", "value": [
                        {"tag": 1, "type": "0x0420",
                         "value": [0., 0., 200., 0., 200., 40., 0., 40.]},
                        {"tag": 2, "type": "0x0414", "value": [0, 1, 1, 1, 4]}]},
                    {"tag": 15, "type": "0x0002", "value": 1},
                    {"tag": 20, "type": "0x0020", "value": 3.},
                ],
                "index": 2, "z_order_raw": 1, "layer_raw": 0,
                "opacity": 1., "tool_raw": 2}
        summary = {"title": "Tape", "pages": [
            {"id": "P", "stroke_object_set_id": None, "attachment_ids": [],
             "size": [500., 500.], "background_pdf_id": None, "background_provider": None,
             "paper": None, "background_page_raw": 0, "order_key": ""}],
            "layers": [], "objects": [tape]}
        report = {"blocks": []}
        doc = render(b"", parser=lambda _: report | {"semantic_summary": summary})
        svg = doc['pages'][0]['svg']
        self.assertIn(f'data-tape="object:2" data-revealed="1" opacity="{TAPE_OPEN:.5f}"', svg)
        tag = dict(tape, type_raw=19, kind_in_samples="tag", id="G", index=3,
                   tool_raw=0, payload_fields=[
                       {"tag": 1, "type": "0x0002", "value": 19},
                       {"tag": 2, "type": "0x0821", "value": [60., 20.]},
                       {"tag": 4, "type": "0x0007", "value": [
                           {"tag": 2, "type": "0x0405", "value": ["#SD I"]},
                           {"tag": 3, "type": "0x0402", "value": [0]},
                           {"tag": 4, "type": "0x0402", "value": []}]},
                   ])
        summary["objects"] = [tag]
        svg = render(b"", parser=lambda _: report | {"semantic_summary": summary})['pages'][0]['svg']
        self.assertIn('fill="#e8eefb"', svg)
        self.assertIn('#SD I', svg)


        server = LocalServer(('127.0.0.1', 0), Handler)
        server.samples = {p.name:p for p in (ROOT/'samples').glob('*.noteful')}
        server.initial = 'Examen wuolah.noteful'
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        url = f'http://127.0.0.1:{server.server_port}'
        try:
            for data in (b'not a note', (ROOT/'samples/nota_1linea.noteful').read_bytes()[:-1]):
                with self.assertRaises(urllib.error.HTTPError) as caught:
                    urllib.request.urlopen(urllib.request.Request(url+'/api/open',data=data))
                self.assertEqual(caught.exception.code, 422)
                self.assertIn('error', json.load(caught.exception))
                caught.exception.close()
            for p in server.samples.values():
                req = urllib.request.Request(url+'/api/open', data=p.read_bytes())
                with urllib.request.urlopen(req) as response:
                    self.assertGreater(json.load(response)['page_count'], 0)
            with urllib.request.urlopen(url+'/reference.pdf') as response:
                self.assertTrue(response.read().startswith(b'%PDF'))
        finally:
            server.shutdown()
            server.server_close()
            thread.join()


if __name__ == '__main__':
    unittest.main()
