import copy
from pathlib import Path
import struct
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "research/python"))
from noteful import (FormatError, Reader, audio_kind, decode_eraser_mask,
                     decode_sample_strokes, encode_fields, object_semantics, parse,
                     semantic_summary, visible_runs)


class NotefulTests(unittest.TestCase):
    def test_corpus_counts_and_references(self):
        expected = {"nota_vacia": (0, 0), "nota_1linea": (1, 0), "nota_2lineas": (2, 0),
                    "nota_lineagruesa": (1, 0), "nota_imagen": (0, 1),
                    "nota_herramientalinea": (0, 1), "nota_herramientaline+imagen": (0, 2)}
        for name, counts in expected.items():
            with self.subTest(name=name):
                r = parse((ROOT / "samples" / (name + ".noteful")).read_bytes())
                summary = semantic_summary(r)
                self.assertEqual(summary["title"], name)
                self.assertEqual(len(summary["pages"]), 1)
                self.assertEqual((sum(len(b.get("strokes", [])) for b in r["blocks"]),
                                  len(summary["objects"])), counts)
                blocks = {b["id"]: b for b in r["blocks"]}
                page = summary["pages"][0]
                self.assertEqual(blocks[page["background_pdf_id"]]["kind"], "pdf")
                if page["stroke_object_set_id"]:
                    self.assertEqual(blocks[page["stroke_object_set_id"]]["kind"], "stroke_object_set")
                for obj in summary["objects"]:
                    if obj["kind_in_samples"] == "image":
                        self.assertIn(obj["asset_id"], page["attachment_ids"])
                        self.assertEqual(blocks[obj["asset_id"]]["kind"], "png")

    def test_every_structured_byte_round_trips(self):
        for p in (ROOT / "samples").glob("*.noteful"):
            data = p.read_bytes()
            r = parse(data)
            rebuilt = bytearray(data[:4])
            for b in sorted(r["blocks"], key=lambda b: b["offset"]):
                original = data[b["offset"]:b["offset"] + b["size"]]
                raw = encode_fields(b["fields"]) if "fields" in b else original
                self.assertEqual(raw, original, f"{p.name}: {b['id']}")
                rebuilt.extend(raw)
            rebuilt.extend(encode_fields(r["index_fields"]))
            rebuilt.extend(data[-16:])
            self.assertEqual(bytes(rebuilt), data, p.name)

    def test_truncation(self):
        data = (ROOT / "samples/nota_1linea.noteful").read_bytes()
        for cut in (0, 1, 4, 19, 20, 509, 126291, len(data) - 1):
            with self.subTest(cut=cut), self.assertRaises(FormatError):
                parse(data[:cut])

    def test_forged_offsets_and_lengths(self):
        data = bytearray((ROOT / "samples/nota_1linea.noteful").read_bytes())
        r = parse(data)
        bad = data.copy()
        struct.pack_into(">Q", bad, len(bad) - 12, len(bad) + 1)
        with self.assertRaises(FormatError):
            parse(bad)
        for tag in (11, 12):
            index = copy.deepcopy(r["index_fields"])
            field = next(f for f in index if f["tag"] == tag)
            field["value"][0] = len(data) + 100
            bad = data.copy()
            bad[r["index_offset"]:-16] = encode_fields(index)
            with self.assertRaises(FormatError):
                parse(bad)

    def test_unsupported_and_short_fields(self):
        for raw in (b"\0", bytes.fromhex("000100ff"), bytes.fromhex("00010402000000ff")):
            with self.assertRaises(FormatError):
                Reader(raw).fields()
        with self.assertRaises(FormatError):
            decode_sample_strokes(b"\xf1\x02")

    def test_eraser_mask_cuts_strokes_into_visible_runs(self):
        style = b"\xf1\x02" + struct.pack(">ddddH", 0, 0, 0, 1, 0) + bytes(8)
        header = bytearray(38)
        struct.pack_into(">H", header, 8, 2)
        points = [(0., 0.), (10., 0.), (20., 0.)]
        mask = [0., 0., .25, .5]
        auxiliary = struct.pack(">II", 0, 2) + struct.pack(">ffff", *mask)
        stroke = (b"\xf1\x01" + header + struct.pack(">dII", 2, 0, 3) + auxiliary
                  + struct.pack(">ffffff", *(v for point in points for v in point)))
        s, = decode_sample_strokes(style + stroke)
        self.assertEqual(s["eraser_mask"], [[0., 0.], [.25, .5]])
        self.assertEqual(len(s["visible_runs"]), 2)
        self.assertEqual(s["visible_runs"][0]["points"], [[0., 0.], [10., 0.]])
        self.assertEqual(s["visible_runs"][1]["points"][0], [15., 0.])
        self.assertEqual(s["visible_runs"][1]["points"][1], [17.5, 0.])
        self.assertIsNone(decode_eraser_mask(0, 3, auxiliary))
        self.assertIsNone(decode_eraser_mask(2, 3, auxiliary[:-4]))
        self.assertEqual(visible_runs(points, [], None), [(points, [])])

    def test_tape_lock_crop_and_tag_semantics(self):
        tape = object_semantics({1: 3, 15: 1}, 2)
        self.assertEqual(tape["kind_in_samples"], "rounded_rectangle")
        self.assertEqual(tape["tape"], {"revealed": True})
        self.assertFalse(tape["locked"])
        self.assertIsNone(object_semantics({1: 3, 15: 1}, 0)["tape"])
        self.assertTrue(object_semantics({1: 1, 21: 1}, 0)["locked"])
        crop = object_semantics({1: 1, 12: {1: [0, 183, 546, 183, 546, 391, 0, 391],
                                            2: [0, 1, 1, 1, 4]}}, 0)
        self.assertEqual(crop["crop_bounds"], [0., 183., 546., 391.])
        self.assertEqual(object_semantics({1: 19}, 0)["kind_in_samples"], "tag")
        self.assertIsNone(object_semantics({1: 1, 12: {1: [0, 0, 0, 0]}}, 0)["crop_bounds"])

    def test_audio_signatures_include_webm(self):
        self.assertEqual(audio_kind(b"\x1aE\xdf\xa3" + bytes(12)), "webm")


if __name__ == "__main__":
    unittest.main()
