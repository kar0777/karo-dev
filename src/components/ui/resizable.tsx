'use client';

import { GripVertical } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

export type ResizableDirection = 'horizontal' | 'vertical';

interface PanelApi {
  collapsible: boolean;
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
}

interface PanelsContextValue {
  direction: ResizableDirection;
  panels: React.RefObject<Map<string, PanelApi>>;
}

const PanelsContext = React.createContext<PanelsContextValue | null>(null);

function usePanels(component: string): PanelsContextValue {
  const context = React.useContext(PanelsContext);
  if (!context) throw new Error(`<${component}> must be rendered inside <ResizablePanels>.`);
  return context;
}

function toCssSize(size: number | string | undefined): string | undefined {
  if (size === undefined) return undefined;
  return typeof size === 'number' ? `${size}px` : size;
}

export interface ResizablePanelsProps extends React.ComponentProps<'div'> {
  /** `horizontal` lays panels out side by side; `vertical` stacks them. */
  direction?: ResizableDirection;
}

/**
 * Layout shell for a resizable split.
 *
 * The group is deliberately stateless: handles report pixel deltas and the
 * parent decides what the new sizes are. That keeps persistence (per project,
 * per user, per workspace pane) out of the primitive and in the feature that
 * actually knows where it belongs.
 */
export function ResizablePanels({
  direction = 'horizontal',
  className,
  ...props
}: ResizablePanelsProps) {
  const panels = React.useRef<Map<string, PanelApi>>(new Map());
  const value = React.useMemo<PanelsContextValue>(() => ({ direction, panels }), [direction]);

  return (
    <PanelsContext.Provider value={value}>
      <div
        data-slot="resizable-panels"
        data-direction={direction}
        className={cn(
          'flex h-full w-full items-stretch overflow-hidden',
          direction === 'vertical' && 'flex-col',
          className,
        )}
        {...props}
      />
    </PanelsContext.Provider>
  );
}

export interface ResizablePanelProps extends React.ComponentProps<'div'> {
  /** Initial size in px, or any CSS length (`'30%'`, `'20rem'`). Omit to fill. */
  defaultSize?: number | string;
  /** Controlled size — the parent owns it while dragging. */
  size?: number | string;
  minSize?: number;
  maxSize?: number;
  collapsible?: boolean;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  /** Width/height kept while collapsed — leave a rail here if you need one. */
  collapsedSize?: number;
}

export function ResizablePanel({
  defaultSize,
  size,
  minSize,
  maxSize,
  collapsible = false,
  collapsed = false,
  onCollapsedChange,
  collapsedSize = 0,
  className,
  style,
  children,
  ...props
}: ResizablePanelProps) {
  const { direction, panels } = usePanels('ResizablePanel');
  const id = React.useId();
  const isCollapsed = collapsible && collapsed;

  // Re-registered every render so the neighbouring handle always sees the
  // current collapse callback without the parent memoising anything.
  React.useEffect(() => {
    const registry = panels.current;
    registry.set(id, {
      collapsible,
      collapsed: isCollapsed,
      setCollapsed: (next) => onCollapsedChange?.(next),
    });
    return () => {
      registry.delete(id);
    };
  });

  const basis = isCollapsed ? `${collapsedSize}px` : toCssSize(size ?? defaultSize);
  const sizeStyle: React.CSSProperties = basis
    ? { flexBasis: basis, flexGrow: 0, flexShrink: 0 }
    : {};

  if (direction === 'horizontal') {
    sizeStyle.minWidth = isCollapsed ? collapsedSize : minSize;
    sizeStyle.maxWidth = isCollapsed ? collapsedSize : maxSize;
  } else {
    sizeStyle.minHeight = isCollapsed ? collapsedSize : minSize;
    sizeStyle.maxHeight = isCollapsed ? collapsedSize : maxSize;
  }

  return (
    <div
      data-slot="resizable-panel"
      data-panel-id={id}
      data-collapsed={isCollapsed ? 'true' : undefined}
      data-min-size={minSize}
      data-max-size={maxSize}
      className={cn('relative overflow-hidden', !basis && 'flex-1', className)}
      style={{ ...sizeStyle, ...style }}
      {...props}
    >
      {children}
    </div>
  );
}

export interface ResizableHandleProps extends Omit<React.ComponentProps<'div'>, 'onResize'> {
  /** Pixel movement since the last event. Positive grows the panel before it. */
  onResize?: (deltaPx: number) => void;
  onResizeStart?: () => void;
  onResizeEnd?: () => void;
  /** Home key. Defaults to collapsing the preceding collapsible panel. */
  onCollapse?: () => void;
  /** End key. Defaults to expanding the preceding collapsible panel. */
  onExpand?: () => void;
  /** Pixels moved per arrow-key press. */
  keyboardStep?: number;
  /** Shows a grip so the handle is discoverable on touch. */
  withHandle?: boolean;
  disabled?: boolean;
}

export function ResizableHandle({
  onResize,
  onResizeStart,
  onResizeEnd,
  onCollapse,
  onExpand,
  keyboardStep = 16,
  withHandle = false,
  disabled = false,
  className,
  'aria-label': ariaLabel,
  ...props
}: ResizableHandleProps) {
  const { direction, panels } = usePanels('ResizableHandle');
  const ref = React.useRef<HTMLDivElement | null>(null);
  const dragOrigin = React.useRef<number | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const [metrics, setMetrics] = React.useState<{
    now: number;
    min: number;
    max: number;
  } | null>(null);

  const horizontal = direction === 'horizontal';

  /** The panel this handle resizes — always the one immediately before it. */
  const previousPanel = React.useCallback(() => {
    const node = ref.current?.previousElementSibling;
    return node instanceof HTMLElement ? node : null;
  }, []);

  // Live aria-valuenow: a splitter that never reports its position is a
  // splitter screen-reader users cannot operate.
  React.useEffect(() => {
    const node = ref.current;
    const previous = previousPanel();
    const container = node?.parentElement;
    if (!previous || !container || typeof ResizeObserver === 'undefined') return;

    const read = () => {
      const panelRect = previous.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const now = Math.round(horizontal ? panelRect.width : panelRect.height);
      const total = Math.round(horizontal ? containerRect.width : containerRect.height);
      const min = Math.round(Number(previous.dataset.minSize ?? 0) || 0);
      const declaredMax = Number(previous.dataset.maxSize ?? 0) || total;
      const max = Math.round(Math.min(declaredMax, total));
      setMetrics((current) =>
        current && current.now === now && current.min === min && current.max === max
          ? current
          : { now, min, max },
      );
    };

    read();
    const observer = new ResizeObserver(read);
    observer.observe(previous);
    observer.observe(container);
    return () => observer.disconnect();
  }, [horizontal, previousPanel]);

  const setBodyDragStyles = React.useCallback(
    (active: boolean) => {
      document.body.style.cursor = active ? (horizontal ? 'col-resize' : 'row-resize') : '';
      document.body.style.userSelect = active ? 'none' : '';
    },
    [horizontal],
  );

  // Never leave the page stuck with a resize cursor if we unmount mid-drag.
  React.useEffect(() => {
    if (!dragging) return;
    return () => setBodyDragStyles(false);
  }, [dragging, setBodyDragStyles]);

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragOrigin.current = horizontal ? event.clientX : event.clientY;
    setDragging(true);
    setBodyDragStyles(true);
    onResizeStart?.();
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (dragOrigin.current === null) return;
    const position = horizontal ? event.clientX : event.clientY;
    const delta = position - dragOrigin.current;
    if (delta === 0) return;
    dragOrigin.current = position;
    onResize?.(delta);
  }

  function endDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (dragOrigin.current === null) return;
    dragOrigin.current = null;
    setDragging(false);
    setBodyDragStyles(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    onResizeEnd?.();
  }

  const toggleAdjacent = React.useCallback(
    (collapsed: boolean) => {
      const previous = previousPanel();
      const panelId = previous?.dataset.panelId;
      const api = panelId ? panels.current.get(panelId) : undefined;
      if (api?.collapsible) {
        api.setCollapsed(collapsed);
        return true;
      }
      return false;
    },
    [panels, previousPanel],
  );

  function collapse() {
    if (onCollapse) {
      onCollapse();
      return;
    }
    // No collapsible neighbour: shrink it to its minimum instead.
    if (!toggleAdjacent(true)) onResize?.(-10_000);
  }

  function expand() {
    if (onExpand) {
      onExpand();
      return;
    }
    if (!toggleAdjacent(false)) onResize?.(10_000);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (disabled) return;
    const back = horizontal ? 'ArrowLeft' : 'ArrowUp';
    const forward = horizontal ? 'ArrowRight' : 'ArrowDown';

    switch (event.key) {
      case back:
        event.preventDefault();
        onResize?.(-keyboardStep);
        break;
      case forward:
        event.preventDefault();
        onResize?.(keyboardStep);
        break;
      case 'Home':
        event.preventDefault();
        collapse();
        break;
      case 'End':
        event.preventDefault();
        expand();
        break;
      default:
        break;
    }
  }

  return (
    <div
      ref={ref}
      role="separator"
      // The bar itself is vertical when the panels sit side by side.
      aria-orientation={horizontal ? 'vertical' : 'horizontal'}
      aria-label={ariaLabel ?? (horizontal ? 'Resize panel width' : 'Resize panel height')}
      aria-valuenow={metrics?.now}
      aria-valuemin={metrics?.min}
      aria-valuemax={metrics?.max}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      data-slot="resizable-handle"
      data-dragging={dragging ? 'true' : undefined}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={handleKeyDown}
      onDoubleClick={() => {
        if (disabled) return;
        const isCollapsed = previousPanel()?.dataset.collapsed === 'true';
        toggleAdjacent(!isCollapsed);
      }}
      className={cn(
        'group relative z-10 shrink-0 touch-none select-none',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        horizontal ? 'w-1 cursor-col-resize' : 'h-1 cursor-row-resize',
        disabled && 'pointer-events-none cursor-default',
        className,
      )}
      {...props}
    >
      <div
        aria-hidden="true"
        className={cn(
          'absolute bg-line transition-colors duration-150 ease-[var(--k-ease)]',
          'group-hover:bg-primary group-focus-visible:bg-primary group-data-[dragging=true]:bg-primary',
          horizontal
            ? 'inset-y-0 left-1/2 w-px -translate-x-1/2'
            : 'inset-x-0 top-1/2 h-px -translate-y-1/2',
        )}
      />
      {withHandle ? (
        <div
          aria-hidden="true"
          className={cn(
            'absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center',
            'rounded-sm border border-line bg-surface-2 text-subtle shadow-sm',
            'transition-colors duration-150 ease-[var(--k-ease)] group-hover:border-line-strong group-hover:text-fg',
            horizontal ? 'h-6 w-2.5' : 'h-2.5 w-6',
          )}
        >
          <GripVertical className={cn('size-3', !horizontal && 'rotate-90')} />
        </div>
      ) : null}
    </div>
  );
}
