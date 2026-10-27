const paths = {
 menu:'M4 6h16M4 12h16M4 18h16',
 image:'M3 3h18v18H3zM3 17l6-6 4 4 3-3 5 5M15 7h.01',
 pages:'M4 3h16v18H4zM9 3v18M6 7h1M6 11h1M6 15h1',
 select:'m5 3 15 9-7 2-4 7L5 3Z',
 collapse:'m6 14 6-6 6 6',
 pan:'M8 12V6a2 2 0 0 1 4 0v5-7a2 2 0 0 1 4 0v7-5a2 2 0 0 1 4 0v8c0 5-3 8-7 8h-1c-2 0-3-1-4-3l-4-6a2 2 0 0 1 3-2l1 1Z',
 draw:'m4 16-1 5 5-1L20 8l-4-4L4 16Zm10-10 4 4M4 16l4 4',
 highlight:'m9 4 8 8-5 5-8-8 5-5ZM5 10l-3 6 6-2M2 22h20',
 erase:'m14 3 7 7a2 2 0 0 1 0 3l-7 8H8l-6-6a2 2 0 0 1 0-3L11 3a2 2 0 0 1 3 0ZM6 8l10 10M13 21h9',
 shape:'M3 3h12v12H3zM15 9a7 7 0 1 1-6 6',
 layers:'m12 3 10 5-10 5L2 8l10-5Zm-10 9 10 5 10-5M2 16l10 5 10-5',
 undo:'M9 5 3 11l6 6M3 11h11a6 6 0 0 1 6 6',
 redo:'m15 5 6 6-6 6m6-6H10a6 6 0 0 0-6 6',
 open:'M12 16V3m-5 5 5-5 5 5M4 14v6a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-6',
 export:'M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4',
 plus:'M12 5v14M5 12h14',
 note:'M6 3h10l4 4v14H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm9 0v5h5M8 12h8M8 16h6',
 headphones:'M4 14v-3a8 8 0 0 1 16 0v3M4 12H2v8h5v-8H4Zm16 0h2v8h-5v-8h3',
 home:'M3 11 12 3l9 8M5 9v12h5v-6h4v6h5V9',
 search:'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm9 16-4-4',
 settings:'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4',
 cloud:'M7 18a5 5 0 1 1 1-9.9A6 6 0 0 1 19 10a4 4 0 0 1 0 8H7Z',
 cards:'M7 4h12v14H7zM4 7v13h12',
 save:'M5 3h11l4 4v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm2 0v6h9V3M7 21v-7h10v7',
 spark:'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Zm7 11 .9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9L19 14Z',
 grab:'M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M9 9h6v6H9z',
 tape:'M3 8.5 18 4l3 9.5L6 18 3 8.5Zm3.4 1.6.6 2m3-3.1.6 2m3-3.1.6 2'
};
export function icon(name) {
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
 for(const [key,value] of Object.entries({viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'1.65','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'}))svg.setAttribute(key,value);
 const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',paths[name]||paths.note);svg.append(path);return svg;
}
export function decorateIcons(){
 for(const el of document.querySelectorAll('[data-icon]'))el.prepend(icon(el.dataset.icon));
 for(const el of document.querySelectorAll('button[data-tool]')){el.setAttribute('aria-label',el.textContent.trim());el.title=el.textContent.trim();el.prepend(icon(el.dataset.tool));}
}
