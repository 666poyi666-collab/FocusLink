/* 一次性探针：量设置页的真实几何与字体装载，用于确定 contain-intrinsic-size 与字体债。
 * 只读，不改任何东西。用法见 scripts/verify/perf-budget.mjs 的 --probe 模式。 */
(async () => {
  const rect = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top) };
  };
  const sections = [...document.querySelectorAll('.settings-stack > .settings-section')];
  const choices = [...document.querySelectorAll('.instrument-choice')];
  const scroller = document.querySelector('.settings-page');
  const scrollerStyle = scroller ? getComputedStyle(scroller) : null;
  const fonts = [...document.fonts].map((f) => ({
    family: f.family,
    status: f.status,
    weight: f.weight,
  }));
  const loaded = fonts.filter((f) => f.status === 'loaded');
  return {
    page: rect(scroller),
    scrollerOverflowY: scrollerStyle ? scrollerStyle.overflowY : null,
    scrollHeight: scroller ? scroller.scrollHeight : null,
    viewportH: window.innerHeight,
    sectionCount: sections.length,
    sections: sections.map((s) => ({
      h: rect(s).h,
      top: rect(s).top,
      cls: s.className.toString().slice(0, 60),
    })),
    instrumentChoices: {
      count: choices.length,
      size: rect(choices[0]),
      gridCols: choices[0] ? getComputedStyle(choices[0].parentElement).gridTemplateColumns : null,
    },
    fontFaceCount: fonts.length,
    fontLoadedCount: loaded.length,
    loadedFamilies: [...new Set(loaded.map((f) => f.family))],
  };
})();
