import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/* ────────────────────────────────────────────────────────────────────────────
   统计页「原型 → 客户端」契约（FL-STATS-CONTRACT）

   为什么有这道测试（2026-09-29）：
     同一个病在项目里反复发作 —— **原型改了、客户端只搬了一部分、然后被声明为完成**。
       · v1.3.9 任务页：b50b858 宣称「1:1 完全对齐」，实测被推翻（数值抄了但被覆盖）。
       · v1.3.12 统计页：只搬了卡贴层；页面级结构（统计视图侧栏、清单分类、
         页头语义、96px 表盘）全都没落，客户端实测 `tiles:5` 但侧栏/页头完全不存在。
     当时的验收只看「有没有写进代码」，不看「两侧是否一致」。

   这道测试把用户已确认的原型冻成契约：
     ① 原型文件指纹变了 → 必须重新提取契约（否则客户端可以悄悄落后于原型）；
     ② 原型里的每个结构选择器都必须出现在客户端源码里；
     ③ 原型里的每条界面文案都必须出现在客户端源码里；
     ④ 一批关键计算值（表盘 96px、卡贴 12px 圆角、侧栏 32px/6px、导航数字 11px…）
        必须能在客户端 CSS 里找到对应声明。

   刷新契约（原型变更后必须执行）：
     node scripts/regression/extract-stats-prototype-contract.cjs
   ──────────────────────────────────────────────────────────────────────────── */

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixturePath = path.join(projectRoot, 'tests', 'fixtures', 'statsPrototypeContract.json');

type FrozenStyle = {
  w: number;
  h: number;
  bg: string;
  radius: string;
  fontSize: string;
  fontWeight: string;
};
type Contract = {
  prototypeFile: string;
  prototypeSha256: string;
  capturedAt: string;
  requiredSelectors: string[];
  requiredTexts: string[];
  frozenStyles: Record<string, FrozenStyle>;
};

const contract = JSON.parse(readFileSync(fixturePath, 'utf8')) as Contract;

const HISTORY_DIR = path.join(projectRoot, 'src', 'features', 'history');

/** 扫描统计页的**全部**源码：目录下所有 tsx/ts/css + 统计样式表。
 *  早先只列了三个固定文件，结果新建的 StatsSidebar.tsx 不在扫描范围内，
 *  契约误报「侧栏结构缺失」。扫描范围必须跟着组件拆分走，不能写死文件清单。 */
function clientSources(): string[] {
  const files: string[] = [];
  if (existsSync(HISTORY_DIR)) {
    for (const name of readdirSync(HISTORY_DIR)) {
      if (/\.(tsx?|css)$/.test(name)) files.push(path.join(HISTORY_DIR, name));
    }
  }
  files.push(path.join(projectRoot, 'src', 'styles', 'stats-workbench.css'));
  return files.filter((p) => existsSync(p));
}

function readAll(): string {
  return clientSources()
    .map((p) => readFileSync(p, 'utf8'))
    .join('\n');
}

/** 全部样式表：统计页与侧栏的规则分散在 stats-workbench.css / task-workbench.css 等多处。 */
function allCss(): string {
  const dir = path.join(projectRoot, 'src', 'styles');
  if (!existsSync(dir)) return '';
  return readdirSync(dir)
    .filter((n) => n.endsWith('.css'))
    .map((n) => readFileSync(path.join(dir, n), 'utf8'))
    .join('\n');
}

/** 取出某个选择器的**全部** CSS 规则块（拼接），找不到返回 null。
 *  同一个类常常被拆成多条规则（基础规则 + span-5/span-7 变体），只取第一条会误判。 */
function cssBlock(css: string, selector: string): string | null {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(^|[},])\\s*([^{}]*${escaped}[^{}]*)\\{([^}]*)\\}`, 'gm');
  const blocks: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) blocks.push(m[3]);
  return blocks.length ? blocks.join('\n') : null;
}

/** 类名可能以 CSS 选择器（带点）或 JSX className（不带点）出现，两种都算命中。 */
function hasClassToken(sources: string, selector: string): boolean {
  return sources.includes(selector) || sources.includes(selector.replace(/^\./, ''));
}

/** 去掉注释，只留下会执行的代码 —— 注释里允许保留被删掉的旧代码作为历史证据。 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

describe('统计页原型契约（FL-STATS-CONTRACT）', () => {
  const sources = readAll();

  it('契约本身完整：选择器、文案、计算值都不是空的', () => {
    expect(contract.requiredSelectors.length).toBeGreaterThanOrEqual(15);
    expect(contract.requiredTexts.length).toBeGreaterThanOrEqual(8);
    expect(Object.keys(contract.frozenStyles).length).toBeGreaterThanOrEqual(10);
  });

  /* ① 原型指纹守卫：原型一变，这条立刻红，逼你重新提取契约。
     原型在仓库外（用户桌面），CI 上不存在则跳过；本机开发时它才是真闸门。 */
  it('原型文件未被静默修改（否则必须重新提取契约）', () => {
    const prototype = process.env.FOCUSLINK_STATS_PROTOTYPE
      ? process.env.FOCUSLINK_STATS_PROTOTYPE
      : path.join(
          'C:',
          'Users',
          '16408',
          'Desktop',
          'FocusLink-统计页-预览',
          contract.prototypeFile,
        );
    if (!existsSync(prototype)) {
      // 仓库外文件，CI 环境没有；本机开发时存在，必须校验。
      expect(true).toBe(true);
      return;
    }
    const actual = createHash('sha256').update(readFileSync(prototype)).digest('hex');
    expect(
      actual,
      '统计页原型已被修改，客户端契约可能已经过期。请执行：\n' +
        '  node scripts/regression/extract-stats-prototype-contract.cjs\n' +
        '并把客户端补齐到与原型一致，再提交新的契约。',
    ).toBe(contract.prototypeSha256);
  });

  /* ② 结构：原型有的选择器，客户端源码里必须都能找到 */
  it.each(contract.requiredSelectors)('客户端源码包含原型结构 %s', (selector) => {
    expect(
      hasClassToken(sources, selector),
      `原型要求的结构 ${selector} 在客户端源码里找不到。` +
        '统计页必须与用户已确认的原型保持一致，不能只搬卡贴层。',
    ).toBe(true);
  });

  /* ③ 文案：用户确认过的界面语言不能缺 */
  it.each(contract.requiredTexts)('客户端源码包含原型文案「%s」', (text) => {
    expect(sources.includes(text), `原型文案「${text}」在客户端源码里找不到。`).toBe(true);
  });

  /* ④ 客户端 CSS 必须为原型的每个冻结选择器提供规则。
     注意分工：**源码级只断言「结构/文案/规则存在」**，因为这些是稳定的；
     具体像素值（表盘 96px、卡贴圆角、胶囊字号…）会被 token 与父容器影响，
     用字面量断言极易产生假阴性 —— 数值一致性由运行时实测脚本负责：
       node scripts/regression/extract-stats-prototype-contract.cjs   （原型侧）
       .tmp/stats-diff/client-probe.cjs                                （客户端侧）
     两者并列打印即为差异表。 */
  it('客户端 CSS 为每个原型冻结选择器提供了规则', () => {
    /* 侧栏样式复用了任务页已有的 task-workbench.css，因此要在**全部**样式表里找规则，
       只看 stats-workbench.css 会误报「侧栏未移植」。 */
    const css = allCss();
    const missing: string[] = [];
    for (const selector of Object.keys(contract.frozenStyles)) {
      if (!hasClassToken(sources, selector)) missing.push(selector);
      else if (!cssBlock(css, selector)) missing.push(selector + '(无 CSS 规则)');
    }
    expect(missing, '以下原型结构在客户端缺少 CSS 规则：' + missing.join(', ')).toEqual([]);
  });

  it('冻结值可被运行时实测脚本消费（契约含尺寸与字体信息）', () => {
    for (const [selector, style] of Object.entries(contract.frozenStyles)) {
      expect(style.w, selector + ' 缺少宽度').toBeTypeOf('number');
      expect(style.h, selector + ' 缺少高度').toBeTypeOf('number');
      expect(style.fontSize, selector + ' 缺少字号').toMatch(/px$/);
    }
  });

  /* ⑤ 客户端不得把原型的**样例数据**写死成界面读数。
     2026-10-01 事故（用户报告「统计页面的数据来源有问题」）：e67767f（v1.3.15
     「彻底剔除旧版残留」）删掉了侧栏的整套真实取数，改成写死原型样例值 ——
     侧栏显示 今日看板 4.6h / 最近7天 32.2h / 最近30天 128.6h / 心流热力全景 84天
     与 工作任务 55% / 深度学习 25% / 个人生活 12%，与数据库真实值无关。
     结构测试抓不到这类问题（结构、文案、CSS 规则全都「对」），所以单独钉一条：
     **原型的样例数字是设计稿的占位内容，不是客户端可以写死的读数。** */
  it('客户端没有把原型样例读数写死成界面数据', () => {
    const forbidden = [
      { needle: '>4.6h<', what: '原型样例「今日看板 4.6h」' },
      { needle: '>32.2h<', what: '原型样例「最近 7 天 32.2h」' },
      { needle: '>128.6h<', what: '原型样例「最近 30 天 128.6h」' },
      { needle: '4.6 * 3600_000', what: '原型样例 4.6 小时的兜底回落' },
      { needle: '22 * 60_000', what: '原型样例 22 分钟损耗的兜底回落' },
      { needle: 'share: 55', what: '原型样例分类占比 55%' },
      {
        needle: '|| 91',
        what: '原型样例达成率 91% 的兜底（0 是 falsy，会让空数据的一天显示 91%）',
      },
      { needle: "'92.6'", what: '原型样例专注纯度 92.6% 的兜底' },
      { needle: 'streak || 14', what: '原型样例连续打卡 14 天的兜底（0 是 falsy）' },
      { needle: 'summary.count || 4', what: '原型样例 4 个专注会话的兜底（0 是 falsy）' },
      { needle: '42 * MINUTE', what: '原型样例「较昨日增加 42 分钟」的兜底' },
      { needle: 'defMs', what: '原型样例时段时长（黄金上午 130m / 沉浸下午 105m / 晚间收尾 40m）' },
      { needle: '工作任务', what: '原型样例分类名' },
      { needle: '2026年9月22日 - 9月28日', what: '原型样例日期区间' },
      { needle: '2026年8月30日 - 9月28日', what: '原型样例日期区间' },
    ];
    /* 注释里允许引用被删掉的旧代码（那正是历史证据），只扫真正会执行的代码。 */
    const found = forbidden.filter((f) => stripComments(sources).includes(f.needle));
    expect(
      found.map((f) => f.what + '  ← ' + f.needle),
      '统计页把原型样例数据写死成了界面读数。原型是设计稿，样例数字只是占位；' +
        '客户端必须从 sessions:analytics 的真实数据渲染。',
    ).toEqual([]);
  });

  it('统计页确实从 sessions:analytics 取真实数据', () => {
    expect(
      sources.includes('sessions.analytics') || sources.includes("'sessions:analytics'"),
      '统计页必须调用 sessions:analytics 拿真实数据',
    ).toBe(true);
  });
});
