import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// 任务页勾选动效的「可失败契约」。
//
// b50b858 给任务页写了一整套勾选动效 CSS（spring-pop 弹跳、just-restored 恢复闪烁），
// 但 TaskWorkspace.tsx 从头到尾没有应用过这两个类名 —— 于是 v1.3.9 宣称的动效静默失效，
// 而 CSS 少写一个类名、TSX 少挂一个类名，都不会产生任何编译错误。这里把它变成断言。
//
// 同时钉住性能回归：勾选动效只能动合成器属性（transform/opacity），一旦有人把
// box-shadow / width / background 写回 keyframes，160Hz 下就是每帧一次重绘或布局。

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspaceSource = fs.readFileSync(
  path.join(projectRoot, 'src', 'features', 'tasks', 'TaskWorkspace.tsx'),
  'utf8',
);
const workbenchCss = fs.readFileSync(
  path.join(projectRoot, 'src', 'styles', 'task-workbench.css'),
  'utf8',
);
const compactCss = workbenchCss.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\s+/g, ' ');

function extractBraced(source: string, fromIndex: number): string {
  const open = source.indexOf('{', fromIndex);
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return '';
}

function functionBody(source: string, name: string): string {
  const at = source.indexOf(`function ${name}(`);
  return at < 0 ? '' : extractBraced(source, at);
}

function keyframesBody(name: string): string {
  const at = workbenchCss.indexOf(`@keyframes ${name}`);
  return at < 0 ? '' : extractBraced(workbenchCss, at);
}

function animatedSelectors(css: string): string[] {
  const found: string[] = [];
  const pattern = /([^{}]+)\{[^{}]*animation:\s*[A-Za-z0-9_-]+/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(css)) !== null) found.push(match[1].trim().replace(/\s+/g, ' '));
  return found;
}

describe('task check motion contract', () => {
  it('applies every class the stylesheet hangs an animation on', () => {
    const selectors = animatedSelectors(workbenchCss);

    // 至少要覆盖勾选/恢复这两条：类名在 CSS 里存在，却在 TSX 里从没出现过，
    // 正是这一版真实踩过的静默失效。
    expect(selectors.some((selector) => selector.includes('.spring-pop'))).toBe(true);
    expect(selectors.some((selector) => selector.includes('.just-restored'))).toBe(true);

    // 只断言「字符串出现在文件里」太弱：类名挂到错误元素上、或只挂了一半，
    // 都会让动效对某些行静默失效。这里钉死三个真实应用点。
    expect(workspaceSource).toContain(
      "className={`task-check-circle ${springPopTaskId === t.id ? 'spring-pop' : ''}`}",
    );
    expect(workspaceSource).toContain(
      "className={`subtask-check ${springPopSubtaskId === sub.id ? 'spring-pop' : ''}`}",
    );
    expect(workspaceSource).toContain("${restoredTaskId === t.id ? 'just-restored' : ''}");

    for (const selector of selectors) {
      const classes = [...selector.matchAll(/\.([A-Za-z0-9_-]+)/g)].map((m) => m[1]);
      expect(classes.length, `animation selector has no class: ${selector}`).toBeGreaterThan(0);
      const absent = classes.filter((name) => !workspaceSource.includes(name));
      expect(absent, `animated class never applied in TaskWorkspace.tsx: ${selector}`).toEqual([]);
    }
  });

  it('keeps the check-pop and restore animations on compositor-only properties', () => {
    for (const name of ['checkPopPulse', 'checkHaloPulse', 'restoreFlash']) {
      const body = keyframesBody(name);
      expect(body, `missing @keyframes ${name}`).not.toBe('');
      expect(body).not.toMatch(/box-shadow/);
      expect(body).not.toMatch(/background/);
      expect(body).not.toMatch(/\b(width|height|left|top|margin|padding)\s*:/);
      expect(body).toMatch(/transform|opacity/);
    }

    // 光晕环必须落在伪元素上，而不是回到主元素的 box-shadow。
    expect(compactCss).toMatch(
      /\.task-check-circle\.spring-pop::after\s*\{[^}]*border-radius:\s*50%/,
    );
    expect(compactCss).toMatch(
      /\.task-check-circle\.spring-pop::after\s*\{[^}]*animation:\s*checkHaloPulse/,
    );
    expect(compactCss).toMatch(
      /\.task-entry\.just-restored::after\s*\{[^}]*animation:\s*restoreFlash/,
    );
  });

  it('never leaves a finished check animation overriding the hover state', () => {
    // animation-fill-mode: forwards 会把最后一帧永久钉在元素上，压住
    // .task-check-circle:hover { transform: scale(1.12) }。而残留的 .spring-pop 是真实会
    // 出现的：连续快速勾选时，上一行的动画会被下一次 setState 摘掉类而打断，不触发
    // animationend，类就留在那里了。所以动效必须靠「基态 == 末帧」而不是 forwards。
    expect(compactCss).not.toMatch(/animation:\s*checkPopPulse[^;]*forwards/);
    expect(compactCss).not.toMatch(/animation:\s*checkHaloPulse[^;]*forwards/);
    expect(compactCss).not.toMatch(/animation:\s*restoreFlash[^;]*forwards/);

    // 去掉 forwards 之后，基态必须自己就是「不可见」，否则光晕/闪烁会停在可见状态。
    expect(compactCss).toMatch(/\.task-check-circle\.spring-pop::after\s*\{[^}]*opacity:\s*0/);
    expect(compactCss).toMatch(/\.subtask-check\.spring-pop::after\s*\{[^}]*opacity:\s*0/);
    expect(compactCss).toMatch(/\.task-entry\.just-restored::after\s*\{[^}]*opacity:\s*0/);
  });

  it('never animates the strike laser width again (width forces layout every frame)', () => {
    const laser = extractBraced(workbenchCss, workbenchCss.indexOf('.strike-laser {'));

    expect(laser).toMatch(/transition:\s*transform/);
    expect(laser).not.toMatch(/transition:\s*width/);
    expect(laser).toMatch(/scaleX\(0\)/);
    expect(compactCss).toMatch(/\.task-entry\.is-done \.strike-laser\s*\{[^}]*scaleX\(1\)/);
  });

  it('keeps every task row a layout and paint island', () => {
    expect(compactCss).toMatch(/\.task-entry\s*\{[^}]*contain:\s*layout paint style/);
  });

  it('clears motion classes on animationend instead of a fixed timer', () => {
    expect(workspaceSource).toMatch(/onAnimationEnd=/);
    expect(workspaceSource).toMatch(/animationName === 'checkPopPulse'/);
    expect(workspaceSource).toMatch(/animationName === 'restoreFlash'/);
    expect(workspaceSource).not.toMatch(/setTimeout\(\(\) => \{\s*setSpringPop/);
  });

  it('pools confetti sparks instead of rebuilding body nodes on every check', () => {
    const fire = functionBody(workspaceSource, 'fireConfettiSparks');
    const pool = functionBody(workspaceSource, 'getConfettiPool');

    expect(fire).not.toBe('');
    expect(pool).not.toBe('');
    // 每次勾选都不许再往 body 插/删节点。
    expect(fire).not.toMatch(/document\.body\.appendChild/);
    expect(fire).not.toMatch(/removeChild/);
    expect(fire).not.toMatch(/createElement/);
    // 节点池只在首次建层时挂一次。
    expect(pool).toMatch(/document\.body\.appendChild/);

    expect(compactCss).toMatch(/\.confetti-layer\s*\{[^}]*contain:\s*strict/);
    expect(compactCss).toMatch(/\.confetti-layer\s*\{[^}]*pointer-events:\s*none/);
  });

  it('warms up the shared AudioContext before the first check', () => {
    expect(workspaceSource).toMatch(/function warmUpAudio\(\): void/);
    // 预热必须发生在空闲或首次指针悬停，而不是勾选那一刻。
    expect(workspaceSource).toMatch(/requestIdleCallback/);
    expect(workspaceSource).toMatch(/addEventListener\('pointerover', warm/);
    // 发声路径本身不许新建 context。
    const chime = functionBody(workspaceSource, 'playCheckChime');
    expect(chime).not.toMatch(/new AudioContext/);
    expect(chime).not.toMatch(/new AudioCtxClass/);
  });
});
