import * as React from 'react';

/**
 * Icon props accept either a component (`icon={Boxes}`) or an already-rendered
 * node (`icon={<Boxes className="text-primary" />}`) — both spellings show up
 * in real code, and guessing wrong costs a build.
 */
export type IconLike = React.ComponentType<{ className?: string }> | React.ReactNode;

function isComponentType(value: unknown): value is React.ComponentType<{ className?: string }> {
  if (typeof value === 'function') return true;
  if (typeof value === 'object' && value !== null && '$$typeof' in value) {
    const tag = (value as { $$typeof: unknown }).$$typeof;
    // lucide icons are forwardRef exotic components, not plain functions.
    return tag === Symbol.for('react.forward_ref') || tag === Symbol.for('react.memo');
  }
  return false;
}

export function renderIcon(icon: IconLike, className?: string): React.ReactNode {
  if (icon === null || icon === undefined || icon === false) return null;
  if (isComponentType(icon)) {
    const Icon = icon;
    return <Icon className={className} />;
  }
  return icon as React.ReactNode;
}
