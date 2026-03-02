# Metrics Dashboard Redesign

## Goal

Create standardized shadcn-based dashboard components to give all analytics pages (metrics, team health, projects, briefings) a professional, consistent look.

## Approach: Shared Component Library (Approach A)

Create reusable dashboard primitives in `components/ui/`, then migrate all 4 page areas to use them.

## New Components

### `PageHeader`
Consistent header for every analytics page: title, optional description, action slot (date picker, export, etc.).

### `MetricCard`
Single component replacing `StatCards`, `VelocityCards`, and `ScorecardKpis`. Supports icon, value, label, delta indicator, and optional traffic light status.

### `DeltaIndicator`
Extracted from 3 current copies into a single shared component. Props: `value: number`, `size?: "sm" | "md"`.

### `ChartCard` (enhanced)
Add colored top-border accent (`border-t-2`), optional description, and footer slot.

### `TabBar`
Replaces hand-rolled tab buttons in `ReportsView` and `DeveloperComparison`.

### `ButtonGroup`
For `DateRangePicker` preset buttons. Bordered pill container with active/inactive states.

## Visual Styling

- Cards: subtle top-border accent on ChartCard, tinted icon backgrounds on MetricCard (`bg-primary/10`)
- Typography: page titles `text-xl font-semibold`, metric values `text-2xl font-bold tabular-nums`
- Buttons: bordered container for date picker/export, consistent toggle pattern
- Spacing: `space-y-6` section gaps, `gap-4` stat grids, `gap-6` chart grids
- Consistent `p-5` padding across cards

## Files Created
- `components/ui/page-header.tsx`
- `components/ui/metric-card.tsx`
- `components/ui/delta-indicator.tsx`
- `components/ui/tab-bar.tsx`
- `components/ui/button-group.tsx`

## Files Modified
- `components/insights/ChartCard.tsx`
- `components/insights/InsightsOverview.tsx`
- `components/insights/StatCards.tsx`
- `components/insights/PeriodComparison.tsx`
- `components/insights/DeveloperDrillDown.tsx`
- `components/insights/DeveloperComparison.tsx`
- `components/health/HealthView.tsx`
- `components/health/VelocityCards.tsx`
- `components/projects/ProjectsView.tsx`
- `components/reports/ReportsView.tsx`
- `components/reports/cto/ScorecardKpis.tsx`
- `components/ui/date-range-picker.tsx`
- `components/ui/export-button.tsx`
