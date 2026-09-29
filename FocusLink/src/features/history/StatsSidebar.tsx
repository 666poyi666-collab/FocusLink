// 统计页侧栏（原型 `aside.sidebar`）：统计视图 4 项 + 清单分类 4 项 + 侧栏页脚。
//
// 这是「统计页自己的导航列」，不是全局导航。客户端的全局图标导航 `.edge-dock`
// （专注/任务/统计/设置）保持不变并继续占据左侧 64px —— 见 stats-workbench.css 第 10 节
// 的说明：用统计侧栏替换全局导航会让用户到不了任务页与设置页，因此这里是新增一列。
import type { StatsSidebarCategory } from './statsLedgerModel';

export type StatsSidebarViewId = 'today' | '7d' | '30d' | 'heatmap';

export interface StatsSidebarView {
  id: StatsSidebarViewId;
  label: string;
  /** 原型的 nav-num 读数：今日/近 7 天/近 30 天为真实专注时长，热力全景为窗口天数。 */
  value: string;
  active: boolean;
  onSelect: () => void;
  title: string;
}

interface StatsSidebarProps {
  views: StatsSidebarView[];
  categories: StatsSidebarCategory[];
  activeCategory: string;
  onSelectCategory: (key: string) => void;
}

/** 原型 SVG 图标原样内联：Icon 组件里没有对应的日历/折线/柱状/四宫格形状。 */
function ViewIcon({ id }: { id: StatsSidebarViewId }) {
  if (id === 'today') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    );
  }
  if (id === '7d') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    );
  }
  if (id === '30d') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 20V10M18 20V4M6 20v-4" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
    </svg>
  );
}

export function StatsSidebar({
  views,
  categories,
  activeCategory,
  onSelectCategory,
}: StatsSidebarProps) {
  return (
    <aside className="sidebar stats-sidebar" aria-label="统计导航">
      <div className="nav-section">
        <div className="nav-section-title">
          <span>统计视图</span>
        </div>
        {views.map((view) => (
          <button
            key={view.id}
            type="button"
            className="side-item"
            aria-selected={view.active}
            aria-current={view.active ? 'true' : undefined}
            title={view.title}
            onClick={view.onSelect}
          >
            <span className="side-item-icon">
              <ViewIcon id={view.id} />
            </span>
            <span className="side-name">{view.label}</span>
            <span className="nav-num">{view.value}</span>
          </button>
        ))}
      </div>

      <div className="nav-section">
        <div className="nav-section-title">
          <span>清单分类</span>
        </div>
        <button
          type="button"
          className="side-item"
          aria-selected={activeCategory === 'all'}
          title="显示当前范围的全部会话"
          onClick={() => onSelectCategory('all')}
        >
          <span className="project-dot" style={{ background: 'var(--accent)' }} />
          <span className="side-name">全部分类</span>
          <span className="nav-num">100%</span>
        </button>
        {categories.map((category) => (
          <button
            key={category.key}
            type="button"
            className="side-item"
            aria-selected={activeCategory === category.key}
            title={`只看「${category.label}」的会话（占当前范围 ${category.percent}%）`}
            onClick={() => onSelectCategory(category.key)}
          >
            <span className="project-dot" style={{ background: category.color }} />
            <span className="side-name">{category.label}</span>
            <span className="nav-num">{category.percent}%</span>
          </button>
        ))}
      </div>

      <div className="sidebar-footer">
        <div className="sidebar-user-pill">
          <div className="user-avatar-mini">FL</div>
          <span>FocusLink 统计空间</span>
        </div>
        <div className="stats-sidebar-status">
          <i />
          已就绪
        </div>
      </div>
    </aside>
  );
}
