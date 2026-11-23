import {inkOpacity} from './timeline.js';
export function indexTimedInk(container, timings) {
 // Most pages have no timed ink: no walk over every item of a heavy page then.
 if (!timings?.length) return [];
 const byId = new Map(timings.map(timing => [timing.item_id, timing]));
 return [...container.querySelectorAll('[data-item]')].flatMap(el => {
  const timing = byId.get(el.dataset.item);
  return timing ? [{el, timing, opacity:null}] : [];
 });
}
export function updateTimedInk(items, recordingId, time) {
 for (const item of items) {
  const opacity = inkOpacity(item.timing.recording_id === recordingId ? item.timing : null, time);
  if (item.opacity !== opacity) { item.el.setAttribute('opacity', opacity); item.opacity = opacity; }
 }
}
