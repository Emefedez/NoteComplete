#!/usr/bin/env python3
"""Experimental, strict reader for the observed Noteful corpus.

Standard library only. Unknown encodings fail explicitly. Sources are never modified.
Wire field numbers are retained; semantic names are only used where supported.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import struct

MAGIC = bytes.fromhex("aabbccde")


def audio_kind(raw):
    if raw.startswith(b'caff'):return 'caf'
    if len(raw)>=12 and raw[:4]==b'RIFF' and raw[8:12]==b'WAVE':return 'wav'
    if len(raw)>=12 and raw[4:8]==b'ftyp' and raw[8:12] in (b'M4A ',b'M4B '):return 'm4a'
    if raw.startswith(b'ID3'):return 'mp3'
    if raw.startswith(b'fLaC'):return 'flac'
    if raw.startswith(b'OggS'):return 'ogg'
    return None


class FormatError(ValueError):
    pass


class Reader:
    def __init__(self, data: bytes, origin=0, depth=0):
        if depth > 40:
            raise FormatError("Nesting limit exceeded")
        self.data, self.origin, self.depth, self.pos = data, origin, depth, 0

    def take(self, n):
        if n < 0 or n > len(self.data) - self.pos:
            raise FormatError(f"Read outside buffer at 0x{self.origin + self.pos:x}: {n} bytes")
        b = self.data[self.pos:self.pos + n]
        self.pos += n
        return b

    def number(self, fmt):
        result = struct.unpack(">" + fmt, self.take(struct.calcsize(">" + fmt)))
        return result[0] if len(result) == 1 else list(result)

    def scalar(self, kind):
        fmts = {1: "B", 2: "Q", 3: "f", 4: "d", 0x11: "H",
                0x12: "I", 0x13: "Q", 0x14: "I", 0x20: "d", 0x21: "dd", 0x23: "dddd"}
        if kind in fmts:
            value = self.number(fmts[kind])
            vals = value if isinstance(value, list) else [value]
            if any(isinstance(v, float) and not math.isfinite(v) for v in vals):
                raise FormatError("Non-finite floating point value")
            return value
        if kind in (5, 6, 7):
            n = self.number("I")
            origin = self.origin + self.pos
            data = self.take(n)
            if kind == 5:
                try:
                    return data.decode("utf-8")
                except UnicodeDecodeError as e:
                    raise FormatError(f"Invalid UTF-8 at 0x{origin:x}") from e
            if kind == 6:
                return {"offset": origin, "size": n, "hex": data.hex()}
            return Reader(data, origin, self.depth + 1).fields()
        raise FormatError(f"Unknown type 0x{kind:x} at 0x{self.origin + self.pos:x}")

    def fields(self):
        fields = []
        while self.pos < len(self.data):
            start = self.origin + self.pos
            tag, typ = self.number("HH")
            if typ & ~0x0cff:
                raise FormatError(f"Unknown type flags 0x{typ:x} at 0x{start:x}")
            if typ & 0x400:
                n = self.number("I")
                if n > len(self.data) - self.pos:
                    raise FormatError("Array count exceeds remaining bytes")
                value = [self.scalar(typ & 0xff) for _ in range(n)]
            else:
                value = self.scalar(typ & 0xff)
            field = {"tag": tag, "type": f"0x{typ:04x}", "offset": start, "value": value}
            if typ & 0x800:
                field["clock_raw"] = self.number("Q")
            field["size"] = self.origin + self.pos - start
            fields.append(field)
        return fields


def values(fields):
    result = {}
    for f in fields:
        if f["tag"] in result:
            raise FormatError(f"Duplicate tag {f['tag']}")
        result[f["tag"]] = f["value"]
    return result


def encode_fields(fields):
    """Encode the supported wire types. Used for byte-exact round-trip checks."""
    def scalar(kind, value):
        fmts = {1: "B", 2: "Q", 3: "f", 4: "d", 0x11: "H", 0x12: "I",
                0x13: "Q", 0x14: "I", 0x20: "d", 0x21: "dd", 0x23: "dddd"}
        if kind in fmts:
            args = value if isinstance(value, list) else [value]
            return struct.pack(">" + fmts[kind], *args)
        if kind == 5:
            raw = value.encode("utf-8")
        elif kind == 6:
            raw = bytes.fromhex(value["hex"])
        elif kind == 7:
            raw = encode_fields(value)
        else:
            raise FormatError(f"Cannot encode type 0x{kind:x}")
        return struct.pack(">I", len(raw)) + raw

    result = bytearray()
    for f in fields:
        typ = int(f["type"], 16)
        result.extend(struct.pack(">HH", f["tag"], typ))
        if typ & 0x400:
            result.extend(struct.pack(">I", len(f["value"])))
            for value in f["value"]:
                result.extend(scalar(typ & 0xff, value))
        else:
            result.extend(scalar(typ & 0xff, f["value"]))
        if typ & 0x800:
            result.extend(struct.pack(">Q", f["clock_raw"]))
    return bytes(result)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def walk_fields(fields):
    for f in fields:
        yield f
        typ = int(f["type"], 16)
        if typ & 0xff == 7:
            groups = f["value"] if typ & 0x400 else [f["value"]]
            for group in groups:
                yield from walk_fields(group)


def decode_sample_strokes(blob):
    """Decode observed F1 commands, preserving style and unknown auxiliary channels."""
    r = Reader(blob)
    strokes = []
    style = {"rgba": [0., 0., 0., 1.], "tool_raw": 0, "extra_hex": "00" * 8}
    while r.pos < len(blob):
        start = r.pos
        command = r.take(2)
        if command == b"\xf1\x02":
            rgba = r.number("dddd")
            tool = r.number("H")
            extra = r.take(8)
            if not all(math.isfinite(v) and 0 <= v <= 1 for v in rgba):
                raise FormatError(f"Invalid RGBA at +0x{start:x}")
            style = {"rgba": rgba, "tool_raw": tool, "extra_hex": extra.hex()}
            continue
        if command != b"\xf1\x01":
            raise FormatError(f"Unsupported stroke command {command.hex()} at +0x{start:x}")
        prefix = r.take(38)
        flags = struct.unpack_from(">H", prefix, 8)[0]
        if flags & ~0x17:
            raise FormatError(f"Unsupported stroke flags 0x{flags:x} at +0x{start:x}")
        link = None
        if flags & 0x10:
            # Linked stroke: [u32 opaque][u32 len][UTF-8 ID of a kind-23 object].
            opaque, n = r.number("II")
            try:
                link = [opaque, r.take(n).decode("utf-8")]
            except UnicodeDecodeError as e:
                raise FormatError(f"Invalid stroke link at +0x{start:x}") from e
        thickness = r.number("d")
        unknown_30 = r.number("I")
        count = r.number("I")
        dim = 3 if flags & 1 else 2
        if count > len(blob) // 4:
            raise FormatError("Stroke coordinate count exceeds buffer")
        aux = r.take(count * 8) if flags & 2 else b""
        pairs, bounds = [], []
        if count <= 4:
            raw = [r.number("f" * dim) for _ in range(count)]
            encoding = "float32"
        else:
            bounds = r.number("f" * (dim * 2))
            pairs = [r.number("H" * dim) for _ in range(count)]
            raw = [[bounds[j * 2] + v / 65535 * bounds[j * 2 + 1]
                    for j, v in enumerate(point)] for point in pairs]
            encoding = "quantized_uint16"
        if not math.isfinite(thickness) or any(not math.isfinite(v) for point in raw for v in point):
            raise FormatError(f"Non-finite stroke values at +0x{start:x}")
        strokes.append({
            "offset_in_blob": start, "size": r.pos - start,
            "record_prefix": "f101", "opaque_header_hex": prefix.hex(),
            "id_raw": prefix[:8].hex(), "flags": flags,
            "z_order_raw": struct.unpack_from(">Q", prefix, 26)[0],
            "layer_raw": struct.unpack_from(">I", prefix, 34)[0],
            "thickness_candidate": thickness, "unknown_0x30": unknown_30,
            "linked_object": link[1] if link else None,
            "point_count": count, "encoding": encoding,
            "float32_0x38_0x3c_0x40_0x44": bounds[:4],
            "uint16_pairs": [point[:2] for point in pairs],
            "candidate_points": [point[:2] for point in raw],
            "pressure_candidate": [point[2] for point in raw] if dim == 3 else [],
            "radii": [point[2] for point in raw] if dim == 3 else [],
            "auxiliary_hex": aux.hex(), "style": dict(style),
            "geometry_status": "Decoded observed layout; rendering remains approximate",
        })
    return strokes


def parse(data):
    if len(data) < 20 or data[:4] != MAGIC or data[-16:-12] != MAGIC:
        raise FormatError("Noteful start/end magic missing")
    index_offset, index_size = struct.unpack(">QI", data[-12:])
    if index_offset < 4 or index_offset + index_size != len(data) - 16:
        raise FormatError("Invalid index extent")
    fields = Reader(data[index_offset:-16], index_offset).fields()
    index = values(fields)
    if not all(tag in index for tag in (1, 10, 11, 12)):
        raise FormatError("Missing required index fields")
    keys, offsets, sizes = (index[tag] for tag in (10, 11, 12))
    if not all(isinstance(v, list) for v in (keys, offsets, sizes)):
        raise FormatError("Index keys, offsets and sizes must be arrays")
    if not all(isinstance(k, str) for k in keys):
        raise FormatError("Block IDs must be strings")
    if not all(isinstance(v, int) for v in offsets + sizes):
        raise FormatError("Block offsets and sizes must be integers")
    if not (len(keys) == len(offsets) == len(sizes)) or len(set(keys)) != len(keys):
        raise FormatError("Inconsistent index arrays or duplicate asset IDs")
    blocks = []
    for key, offset, size in zip(keys, offsets, sizes):
        if offset < 4 or size <= 0 or offset + size > index_offset:
            raise FormatError(f"Invalid block extent: {key}")
        raw = data[offset:offset + size]
        kind = ("pdf" if raw.startswith(b"%PDF-") else
                "jpeg" if raw.startswith(b"\xff\xd8\xff") else
                "png" if raw.startswith(b"\x89PNG\r\n\x1a\n") else
                audio_kind(raw) if audio_kind(raw) else
                "note_metadata" if key.startswith("n:") else
                "drawing_metadata" if key.startswith("d:") else
                "binary" if key in index.get(3,[]) else "structured")
        block = {"id": key, "offset": offset, "size": size, "kind": kind,
                 "sha256": sha256(raw)}
        if kind in ("note_metadata", "drawing_metadata", "structured"):
            block["fields"] = Reader(raw, offset).fields()
            block["json_values"] = []
            for f in walk_fields(block["fields"]):
                if isinstance(f["value"], str) and f["value"].startswith("{"):
                    try:
                        block["json_values"].append({"offset": f["offset"],
                                                    "value": json.loads(f["value"])})
                    except json.JSONDecodeError:
                        pass
            v = values(block["fields"])
            if key in index.get(4, []):
                block["kind"] = "stroke_object_set"
                block["encoding_version_raw"] = v.get(1)
                blob = v.get(2)
                if isinstance(blob, dict) and "hex" in blob:
                    block["freehand_blob_size"] = blob["size"]
                    try:
                        block["strokes"] = decode_sample_strokes(bytes.fromhex(blob["hex"]))
                    except FormatError as e:
                        block["stroke_decode_error"] = str(e)
                if isinstance(v.get(5), list):
                    objs = values(v[5])
                    block["object_ids"] = objs.get(1, [])
        blocks.append(block)
    expected = 4
    for b in sorted(blocks, key=lambda b: b["offset"]):
        if b["offset"] != expected:
            raise FormatError(f"Gap or overlap at 0x{expected:x}")
        expected += b["size"]
    if expected != index_offset:
        raise FormatError("Block coverage does not reach index")
    return {"magic": MAGIC.hex(), "byte_order": "big-endian", "size": len(data),
            "sha256": sha256(data), "index_offset": index_offset, "index_size": index_size,
            "index_fields": fields, "blocks": blocks, "coverage": "exact"}


def semantic_summary(report):
    """Sample-supported relationships, keeping unverified field semantics explicit."""
    result = {"pages": [], "layers": [], "objects": []}
    for block in report["blocks"]:
        if block["kind"] == "note_metadata":
            v = values(block["fields"])
            result.update(note_id=v.get(1), title=v.get(3))
        if block["kind"] == "drawing_metadata":
            v = values(block["fields"])
            for p in values(v[2]).get(0, []):
                page = values(p)
                assets, background = values(page[2]), values(page[4])
                result["pages"].append({
                    "id": page[1], "stroke_object_set_id": assets.get(0),
                    "attachment_ids": assets.get(2, []),
                    "size": background.get(1), "background_pdf_id": background.get(4) if background.get(0) == 1 else background.get(3),
                    "background_provider": background.get(5),
                    "paper": json.loads(background[6]) if background.get(6) else None,
                    "background_page_raw": background.get(3, 0) if background.get(0) == 1 else background.get(7, 0),
                    "order_key": page.get(5, ""),
                })
            for layer in values(v[3]).get(0, []):
                lv = values(layer)
                result["layers"].append({"id": lv.get(2), "name": lv.get(1),
                                         "opacity_candidate": lv.get(6)})
        if block["kind"] == "stroke_object_set":
            v = values(block["fields"])
            for obj in values(v[5]).get(0, []):
                ov = values(obj)
                payload = values(ov[6])
                result["objects"].append({
                    "id": ov[1], "type_raw": payload.get(1),
                    "kind_in_samples": {1: "image", 2: "rich_text", 3: "rounded_rectangle", 6: "ellipse",
                                        12: "polygon", 20: "line_shape", 21: "curve"}.get(payload.get(1), "unknown"),
                    "transform_raw": values(ov[2]).get(1),
                    "size": payload.get(2), "asset_id": payload.get(10),
                    "stroke_object_set_id": block["id"], "payload_fields": ov[6],
                    "z_order_raw": ov.get(5, 0), "layer_raw": ov.get(4, 0),
                    "opacity": ov.get(8, 1.0), "tool_raw": ov.get(9, 0),
                    "source_size": payload.get(11),
                })
    result["pages"].sort(key=lambda p: p.get("order_key", ""))
    return result


def extract(source, destination):
    data = source.read_bytes()
    report = parse(data)
    report["semantic_summary"] = semantic_summary(report)
    destination.mkdir(parents=True, exist_ok=False)
    # Numeric names avoid trusting archive IDs as filesystem paths.
    for i, b in enumerate(report["blocks"]):
        suffix = {"jpeg": "jpg", "png": "png", "pdf": "pdf"}.get(b["kind"], "bin")
        filename = f"{i:03d}_{b['kind']}.{suffix}"
        (destination / filename).write_bytes(data[b["offset"]:b["offset"] + b["size"]])
        b["file"] = filename
        if "strokes" in b:
            blob = values(b["fields"])[2]
            (destination / f"{i:03d}_freehand.bin").write_bytes(bytes.fromhex(blob["hex"]))
    (destination / "index.bin").write_bytes(data[report["index_offset"]:-16])
    (destination / "manifest.json").write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, nargs="?")
    parser.add_argument("--view", action="store_true", help="Open visual viewer in browser")
    parser.add_argument("--extract", type=Path, help="New output directory; refuses overwrite")
    args = parser.parse_args()
    if args.view or (args.source is None and args.extract is None):
        from viewer import main as view_main
        return view_main(["--file", str(args.source)] if args.source else [])
    if args.source is None:
        parser.error("--extract requires a source file")
    try:
        report = extract(args.source, args.extract) if args.extract else parse(args.source.read_bytes())
    except (FormatError, OSError) as e:
        parser.exit(1, f"Error: {e}\n")
    if args.extract:
        print(f"{len(report['blocks'])} blocks; complete byte coverage; {args.extract}")
    else:
        print(json.dumps(report, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
