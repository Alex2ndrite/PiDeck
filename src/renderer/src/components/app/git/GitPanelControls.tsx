import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { Button } from "../../ui-shadcn/button";
import { Twistie } from "./GitResourceTree";
import { getViewportBoundMenuPlacement } from "./floatingMenuPosition";

export function PaneHeader(props: {
  id: string;
  title: string;
  count?: number;
  open: boolean;
  onToggle: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border bg-background px-2">
      <button
        type="button"
        className="inline-flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-xs font-medium text-foreground hover:bg-accent"
        aria-expanded={props.open}
        aria-controls={`git-pane-${props.id}`}
        onClick={props.onToggle}
      >
        <Twistie open={props.open} />
        <span className="min-w-0 flex-1 truncate font-mono text-[13px] font-semibold tracking-normal uppercase text-[var(--git-panel-fg)]">{props.title}</span>
      </button>
      {props.children && (
        <div className="flex shrink-0 items-center gap-0.5">{props.children}</div>
      )}
      {typeof props.count === "number" && props.count > 0 && (
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-[11px] font-medium text-muted-foreground">{props.count}</span>
      )}
    </div>
  );
}

/**
 * Compact Git pane filter with the app's listbox behavior instead of the
 * platform-native select, so pane headers render consistently on Windows.
 *
 * The dropdown menu is rendered via portal to document.body to avoid being
 * clipped by parent overflow containers (drawer-content-frame, git-drawer-stack,
 * git-drawer-source all have overflow:hidden/auto).
 */
export function GitCompactFilter(props: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  ariaLabel: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const closeMenu = useCallback(() => {
    setOpen(false);
  }, []);

  const updateMenuPosition = useCallback(() => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const placement = getViewportBoundMenuPlacement(
      rect,
      { width: window.innerWidth, height: window.innerHeight },
      { preferredWidth: 240, maxHeight: 240, gap: 2 },
    );
    setMenuStyle({
      position: "fixed",
      left: placement.left,
      top: placement.top,
      bottom: placement.bottom,
      width: placement.width,
      maxHeight: placement.maxHeight,
      zIndex: 9999,
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    updateMenuPosition();

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      // Portal 菜单不属于触发器的 DOM 子树，必须作为同一交互边界处理。
      if (
        containerRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      ) {
        return;
      }
      closeMenu();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };
    const handleScroll = () => updateMenuPosition();
    const handleResize = () => updateMenuPosition();

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", handleResize);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", handleResize);
    };
  }, [open, closeMenu, updateMenuPosition]);

  const selected = props.options.find((option) => option.value === props.value);

  const menuElement = open ? (
    <div
      ref={menuRef}
      className="fixed min-w-0 max-w-[calc(100vw-16px)] max-h-[calc(100vh-16px)] overflow-auto border border-border-strong bg-bg-panel p-1 shadow-[var(--shadow-lg),0_0_0_1px_rgba(0,0,0,0.04)_inset] rounded-md"
      role="listbox"
      style={menuStyle}
    >
      {props.options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`flex min-h-7 w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-sm border-none bg-transparent px-2 py-[5px] text-left text-xs leading-[18px] text-text-primary hover:bg-[color:color-mix(in_srgb,var(--color-text-primary)_8%,var(--color-bg-panel))]${option.value === props.value ? " font-semibold text-[color:var(--color-accent)]" : ""}`}
          role="option"
          aria-selected={option.value === props.value}
          title={option.label}
          onClick={() => {
            props.onChange(option.value);
            closeMenu();
          }}
        >
          <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
            {option.label}
          </span>
          {option.value === props.value && (
            <Check size={12} className="ml-auto shrink-0 text-[color:var(--color-accent)]" />
          )}
        </button>
      ))}
    </div>
  ) : null;

  return (
    <div
      ref={containerRef}
      className={`relative inline-flex${props.className ? ` ${props.className}` : ""}`}
    >
      <Button
        ref={buttonRef}
        type="button"
        variant="ghost"
        size="sm"
        className="h-6 min-w-0 gap-1 overflow-hidden rounded-sm border border-transparent px-2 font-mono text-[13px] whitespace-nowrap text-text-primary transition-[border-color,background-color] duration-150 hover:border-border-subtle hover:bg-bg-hover focus-visible:shadow-[var(--focus-ring)] focus-visible:outline-none"
        aria-label={props.ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          if (!open) updateMenuPosition();
          setOpen((value) => !value);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (!open) updateMenuPosition();
            setOpen(true);
          }
        }}
      >
        <span className="max-w-[80px] truncate">
          {selected?.label ?? props.value}
        </span>
        <ChevronDown
          size={12}
          className={`shrink-0 text-text-tertiary transition-transform duration-150${open ? " rotate-180" : ""}`}
        />
      </Button>
      {menuElement && createPortal(menuElement, document.body)}
    </div>
  );
}
