"""Local SVG preview from decoded content; no Noteful/PDF reference pixels used for ink."""
import base64
import math
from noteful import (FormatError, decode_eraser_mask, parse, semantic_summary,
                     values, visible_runs)
from rich_text import decode_rich_text, text_svg

HIGHLIGHTER_OPACITY = .5  # /ca and /CA in the supplied Noteful PDF export.
TAPE_OPEN = .18  # A tape tapped open stays as a faint band.


def num(v):
    return f'{v:.5f}'


def color(rgba):
    return 'rgb('+','.join(str(round(max(0,min(1,v))*255)) for v in rgba[:3])+')'


def composite(element, opacity=1., tool=0):
    """Use the same Multiply/50% composition for freehand and shape highlighters."""
    if tool not in (0, 1, 2):
        raise FormatError(f'Unsupported drawing tool {tool}')
    if not math.isfinite(opacity) or not 0 <= opacity <= 1:
        raise FormatError('Invalid object opacity')
    opacity *= HIGHLIGHTER_OPACITY if tool == 1 else 1
    mode = ' style="mix-blend-mode:multiply"' if tool == 1 else ''
    return f'<g opacity="{num(opacity)}"{mode}>{element}</g>'


def tape_group(element, ident, revealed):
    """Covering tape is opaque; tapped open it stays faint (not a saved edit)."""
    return (f'<g data-tape="{ident}" data-revealed="{1 if revealed else 0}" '
            f'opacity="{num(TAPE_OPEN if revealed else 1.)}">{element}</g>')


def tape_with_pattern(element):
    """A tape's own drawing plus its striped copy, as in the product renderer."""
    return f'{element}<g class="nc-tape-pattern">{element}</g>'


def path_geometry(coords, commands):
    """Observed M/L/C/Z commands; preserve exact control points and reject leftovers."""
    arities = {0: ('M', 2), 1: ('L', 2), 3: ('C', 6), 4: ('Z', 0)}
    cursor, result = 0, []
    for command in commands:
        if command not in arities:
            raise FormatError(f'Unsupported shape path command {command}')
        letter, count = arities[command]
        if cursor + count > len(coords):
            raise FormatError('Truncated shape coordinates')
        result.append(letter + ' '.join(num(v) for v in coords[cursor:cursor+count]))
        cursor += count
    if cursor != len(coords):
        raise FormatError('Unconsumed shape coordinates')
    return ' '.join(result)


def variable_ink(points, radii, rgba):
    """Union of sample discs and their external tangents; composited once by caller."""
    if len(points) != len(radii) or any(not math.isfinite(r) or r < 0 for r in radii):
        raise FormatError('Invalid per-point radii')
    parts = []
    for (x,y), r in zip(points,radii):
        parts.append(f'<circle cx="{num(x)}" cy="{num(y)}" r="{num(r)}"/>')
    for (x0,y0),(x1,y1),r0,r1 in zip(points,points[1:],radii,radii[1:]):
        dx,dy=x1-x0,y1-y0
        distance=math.hypot(dx,dy)
        if distance <= abs(r1-r0) or distance < 1e-9:
            continue  # One sample disc contains the other.
        ux,uy=dx/distance,dy/distance;k=(r0-r1)/distance;q=math.sqrt(1-k*k)
        ax,ay=k*ux-q*uy,k*uy+q*ux
        bx,by=k*ux+q*uy,k*uy-q*ux
        quad=[(x0+r0*ax,y0+r0*ay),(x1+r1*ax,y1+r1*ay),
              (x1+r1*bx,y1+r1*by),(x0+r0*bx,y0+r0*by)]
        parts.append('<polygon points="'+' '.join(f'{num(x)},{num(y)}' for x,y in quad)+'"/>')
    return f'<g fill="{color(rgba)}">'+''.join(parts)+'</g>'


def shape_element(obj, payload):
    """Draw shapes in native coordinates; apply placement scaling to the whole shape."""
    sw, sh = obj['size']
    _, _, ow, oh, _ = obj['transform_raw']
    st = values(payload.get(7, []))
    stroke = values(st.get(7, [])).get(0, [0, 0, 0, 1])
    width = st.get(2, 0)
    fill_data = values(payload.get(5, []))
    fill = values(fill_data.get(1, [])).get(0)
    attrs = f'stroke="{color(stroke)}" stroke-opacity="{num(stroke[3])}" stroke-width="{num(width)}" stroke-linecap="round" stroke-linejoin="round"'
    attrs += f' fill="{color(fill)}" fill-opacity="{num(fill[3])}"' if fill else ' fill="none"'
    if 13 in payload:
        geometry = values(payload[13])
        path = path_geometry(geometry.get(1, []), geometry.get(2, []))
        element = f'<path d="{path}" {attrs}/>'
    elif obj['type_raw'] == 6:
        element = f'<ellipse cx="{num(sw/2)}" cy="{num(sh/2)}" rx="{num(sw/2)}" ry="{num(sh/2)}" {attrs}/>'
    elif obj['type_raw'] == 3:
        radius = payload.get(20, 0)
        element = f'<rect width="{num(sw)}" height="{num(sh)}" rx="{num(radius)}" {attrs}/>'
    else:
        return None
    # Degenerate straight lines have a zero native height/width in valid notes.
    sx = ow/sw if abs(sw) > 1e-9 else 1
    sy = oh/sh if abs(sh) > 1e-9 else 1
    return f'<g transform="scale({num(sx)} {num(sy)})">{element}</g>'


def image_crop(payload, width, height, source_width, source_height):
    """An image's crop outline (payload tag 12), mapped into its placement box."""
    outline = payload.get(12)
    if not isinstance(outline, dict):
        return None
    coords, commands = outline.get(1, []), outline.get(2, [])
    if len(coords) < 4 or not commands:
        return None
    points = list(zip(coords[0::2], coords[1::2]))
    if any(not all(math.isfinite(v) for v in point) for point in points):
        return None
    x0 = min(x for x, _ in points)
    x1 = max(x for x, _ in points)
    y0 = min(y for _, y in points)
    y1 = max(y for _, y in points)
    if x1 - x0 < 1e-9 or y1 - y0 < 1e-9:
        return None
    sx, sy = width / (x1 - x0), height / (y1 - y0)
    scaled = []
    for x, y in points:
        scaled.extend(((x - x0) * sx, (y - y0) * sy))
    return {
        'left': -x0 * sx, 'top': -y0 * sy,
        'width': source_width * sx, 'height': source_height * sy,
        'outline': path_geometry(scaled, commands),
    }


def run_svg(points, radii, radius, rgba):
    """One visible run, drawn like the core's line or variable-width ink."""
    if not radii:
        if len(points) == 1:
            return (f'<circle cx="{num(points[0][0])}" cy="{num(points[0][1])}" '
                    f'r="{num(radius)}" fill="{color(rgba)}" opacity="{num(rgba[3])}"/>')
        attrs = (f'fill="none" stroke="{color(rgba)}" stroke-width="{num(radius*2)}" '
                 'stroke-linecap="round" stroke-linejoin="round"')
        return ('<polyline points="' + ' '.join(','.join(num(v) for v in xy) for xy in points)
                + f'" {attrs} opacity="{num(rgba[3])}"/>')
    return variable_ink(points, radii, rgba)


def stroke_svg(stroke, index):
    """A stroke's visible runs, composited once; tape strokes are wrapped as tape."""
    points = stroke['candidate_points']
    radii = stroke.get('radii') or []
    auxiliary = bytes.fromhex(stroke.get('auxiliary_hex', ''))
    mask = decode_eraser_mask(stroke['flags'], stroke.get('point_count', len(points)),
                              auxiliary)
    rgba = stroke['style']['rgba']
    element = ''.join(run_svg(part, part_radii, stroke['thickness_candidate'], rgba)
                      for part, part_radii in visible_runs(points, radii, mask))
    element = composite(element, rgba[3], stroke['style']['tool_raw'])
    if stroke['style']['tool_raw'] == 2:
        element = tape_group(tape_with_pattern(element), f'stroke:{index}',
                             bool(stroke['flags'] & 4))
    return element


def render(data, name='Note', parser=parse):
    report = parser(data)
    summary = report.get('semantic_summary') or semantic_summary(report)
    blocks = {b['id']: b for b in report['blocks']}
    pages = []
    for page in summary['pages']:
        w,h = page['size']
        parts = [f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 {w} {h}" width="{w}" height="{h}">']
        paper = page.get('paper') or {}
        parts.append(f'<rect width="100%" height="100%" fill="#{paper.get("pc",16777215):06x}"/>')
        warnings=[]
        if paper.get('lt') in (1,2):
            gap=paper.get('lh',24)*11/6;linew=paper.get('lw',.5)*11/6
            path=f'M 0 {gap} L {gap} {gap}'
            if paper['lt']==2:path+=f' M {gap} 0 L {gap} {gap}'
            parts.append(f'<defs><pattern id="paper" width="{gap}" height="{gap}" patternUnits="userSpaceOnUse"><path d="{path}" fill="none" stroke="#9a9888" stroke-width="{linew}"/></pattern></defs><rect width="100%" height="100%" fill="url(#paper)"/>')
        if not paper and page.get("background_pdf_id") not in blocks:
            warnings.append('This research preview does not render the imported PDF; use the product reader for its actual background.')
        editable=blocks.get(page.get('stroke_object_set_id'),{})
        strokes=editable.get('strokes',[])
        if editable.get('stroke_decode_error'):warnings.append(editable['stroke_decode_error'])
        objects=[o for o in summary['objects'] if o['stroke_object_set_id']==page.get('stroke_object_set_id')]
        elements=[]
        for index, s in enumerate(strokes):
            if not s['candidate_points']:
                continue
            elements.append((s['z_order_raw'], stroke_svg(s, index)))
        unsupported=[]
        for o in objects:
            x,y,ow,oh,angle=o['transform_raw'];sw,sh=o['size'];payload=values(o['payload_fields'])
            transform=f'translate({num(x)} {num(y)}) rotate({num(math.degrees(angle))}) translate({num(-ow/2)} {num(-oh/2)})'
            el=None
            if o['kind_in_samples']=='image' and o['asset_id'] in blocks:
                b=blocks[o['asset_id']];raw=data[b['offset']:b['offset']+b['size']]
                mime={'jpeg':'image/jpeg','png':'image/png'}.get(b['kind'])
                if mime:
                    href='data:'+mime+';base64,'+base64.b64encode(raw).decode()
                    crop=image_crop(payload,ow,oh,sw,sh)
                    if crop:
                        clip=f'nc-crop-{o["id"]}'
                        el=(f'<clipPath id="{clip}"><path d="{crop["outline"]}"/></clipPath>'
                            f'<image x="{num(crop["left"])}" y="{num(crop["top"])}" '
                            f'width="{num(crop["width"])}" height="{num(crop["height"])}" '
                            f'preserveAspectRatio="none" clip-path="url(#{clip})" href="{href}"/>')
                    else:
                        el=f'<image width="{num(ow)}" height="{num(oh)}" preserveAspectRatio="none" href="{href}"/>'
            elif o['type_raw'] in (2,19):
                text = decode_rich_text(values(payload.get(4, [])))
                warnings.extend(text['warnings'])
                sx = ow/sw if abs(sw)>1e-9 else 1
                sy = oh/sh if abs(sh)>1e-9 else 1
                # Kind 19 (owner notes) is a tag such as "#SD I": rich text in a pill.
                pill=(f'<rect width="{num(sw)}" height="{num(sh)}" rx="{num(sh/2)}" '
                      'fill="#e8eefb" stroke="#9fb3df" stroke-width="0.8"/>'
                      if o['type_raw']==19 else '')
                el = f'<g transform="scale({num(sx)} {num(sy)})">{pill}{text_svg(text,sw)}</g>'
            elif o['type_raw'] in (3,6,12,20,21):
                try:
                    el=shape_element(o,payload)
                except FormatError as error:
                    warnings.append(str(error))
                    el=None
                if el is not None and o['type_raw']==3 and o['tool_raw']==2:
                    revealed=payload.get(15)==1
                    ident=f'object:{o.get("index", 0)}'
                    el=tape_group(tape_with_pattern(el),ident,revealed)
            if el is None:unsupported.append(o['type_raw'])
            else:
                el=composite(f'<g transform="{transform}">{el}</g>',o['opacity'],o['tool_raw'])
                elements.append((o.get('z_order_raw',0),el))
        if unsupported:warnings.append(f'{len(unsupported)} objects without a renderer (types {sorted(set(unsupported))}).')
        parts.extend(el for _,el in sorted(elements,key=lambda pair:pair[0]))
        parts.append('</svg>')
        pages.append({'id':page['id'],'svg':''.join(parts),'stroke_count':len(strokes),'object_count':len(objects),'warnings':warnings,'variable_count':sum(bool(s['flags']&1) for s in strokes),'auxiliary_count':sum(bool(s['flags']&2) for s in strokes)})
    return {'name':summary.get('title') or name,'size':len(data),'page_count':len(pages),'stroke_count':sum(p['stroke_count'] for p in pages),'object_count':len(summary['objects']),'pages':pages,'notes':'Research preview: highlighter Multiply at 50%, decoded variable radius, approximate ink interpolation and paper. Auxiliary channels are preserved; this viewer does not edit notes. Unsupported objects are listed per page.'}
