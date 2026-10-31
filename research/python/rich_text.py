"""Independent Python reference for attributed text pools and SVG output."""
import copy
import html
import math
from noteful import FormatError, values

def default_run():
    return dict(text='',font_size=15.,font_family='Helvetica',font_name='',bold=False,
                italic=False,underline=0,strikethrough=0,rgba=[0.,0.,0.,1.],
                alignment=0,line_height=0.,line_spacing=8.)

def decode_rich_text(v):
    runs=[dict(default_run(),text=s if isinstance(s,str) else '') for s in v.get(2,[])]
    warnings=[];style=default_run();cursor=0;indices={i:0 for i in range(5,11)}
    try:
        counts,keys=v.get(3,[]),v.get(4,[])
        if len(counts)!=len(runs):raise FormatError('Text run/count mismatch')
        for run,count in zip(runs,counts):
            if not isinstance(count,int) or count<0 or cursor+count>len(keys):raise FormatError('Truncated text attributes')
            for key in keys[cursor:cursor+count]:
                pool={1:5,2:6,3:6,4:8,5:8,6:7,7:7,8:8,9:9,10:10,11:10,12:10,13:5,14:5}.get(key)
                if pool is None:raise FormatError(f'Unknown text attribute {key}')
                data=v.get(pool,[])
                if indices[pool]>=len(data):raise FormatError(f'Truncated text pool {pool}')
                item=data[indices[pool]];indices[pool]+=1
                if key in (1,13,14):
                    if not isinstance(item,str):raise FormatError('Invalid font name/family')
                    style['font_name' if key==14 else 'font_family']=item
                elif key in (2,3):
                    if item not in (0,1):raise FormatError('Invalid font trait')
                    style['bold' if key==2 else 'italic']=bool(item)
                elif key in (4,5,8):
                    if not isinstance(item,int) or item<0:raise FormatError('Invalid text integer')
                    style[{4:'underline',5:'strikethrough',8:'alignment'}[key]]=item
                elif key==6:
                    rgba=values(item).get(0,[])
                    if len(rgba)!=4 or any(not math.isfinite(n) or not 0<=n<=1 for n in rgba):raise FormatError('Invalid text color')
                    style['rgba']=rgba
                elif key in (10,11,12):
                    if not isinstance(item,(float,int)) or not math.isfinite(item) or not 0<=item<=10000 or key==10 and item==0:raise FormatError('Invalid text size/spacing')
                    style[{10:'font_size',11:'line_height',12:'line_spacing'}[key]]=item
            cursor+=count
            content=run['text'];run.update(copy.deepcopy(style));run['text']=content
        if cursor!=len(keys) or any(indices[i]!=len(v.get(i,[])) for i in indices):raise FormatError('Unconsumed text attributes')
    except FormatError as error:
        warnings.append(f'Texto visible con estilos parciales: {error}')
    return dict(runs=runs,warnings=warnings)

def xml(value):
    value=''.join(c if ord(c)>=32 and c not in '\ufffe\uffff' or c in '\n\r\t' else '\ufffd' for c in value)
    return html.escape(value,quote=True)

def text_svg(text,width):
    lines=[[]]
    for run in text['runs']:
        content=run['text'].replace('\r\n','\n').replace('\r','\n').replace('\u200b','')
        for i,part in enumerate(content.split('\n')):
            if i:lines.append([])
            if part:lines[-1].append((run,part))
    out=[];y=8.
    for line in lines:
        size=max([15.]+[r['font_size'] for r,_ in line]);y+=size
        align=line[0][0]['alignment'] if line else 0
        x,anchor={1:(width/2,'middle'),2:(width-5,'end')}.get(align,(5.,'start'))
        out.append(f'<text x="{x}" y="{y}" text-anchor="{anchor}" xml:space="preserve">')
        for run,content in line:
            decoration=' '.join(x for x,on in [('underline',run['underline']>0),('line-through',run['strikethrough']>0)] if on) or 'none'
            def family(s):return s.replace('\\','\\\\').replace("'","\\'")
            lower=run['font_family'].lower()
            if 'courier' in lower or 'mono' in lower:
                generic="'Courier New', monospace"
            elif 'times' in lower or 'georgia' in lower or 'serif' in lower:
                generic="'Times New Roman', serif"
            elif 'noteworthy' in lower or 'marker' in lower or 'chalk' in lower:
                generic="'Comic Neue', 'Comic Sans MS', cursive"
            else:
                generic='Arial, sans-serif'
            fonts=f"'{family(run['font_family'])}', '{family(run['font_name'])}', {generic}"
            rgb='rgb('+','.join(str(round(c*255)) for c in run['rgba'][:3])+')'
            weight=700 if run['bold'] else 400;slant='italic' if run['italic'] else 'normal'
            out.append(f'<tspan font-family="{xml(fonts)}" font-size="{run["font_size"]}" font-weight="{weight}" font-style="{slant}" text-decoration="{decoration}" fill="{rgb}" fill-opacity="{run["rgba"][3]}">{xml(content)}</tspan>')
        out.append('</text>')
        y+=max([8.]+[max(r['line_height']-size,0) if r['line_height']>0 else size*.2+r['line_spacing'] for r,_ in line])
    return ''.join(out)
