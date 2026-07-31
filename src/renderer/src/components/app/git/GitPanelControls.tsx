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
    <div className="git-pane-header flex h-8 shrink-0 items-center gap-1 border-b border-border bg-background px-2">
      <button
        type="button"
        className="git-pane-header-toggle inline-flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-xs font-medium text-foreground hover:bg-accent"
        aria-expanded={props.open}
        aria-controls={`git-pane-${props.id}`}
        onClick={props.onToggle}
      >
        <Twistie open={props.open} />
        <span className="git-pane-title truncate">{props.title}</span>
      </button>
      {props.children && (
        <div className="git-pane-header-actions flex shrink-0 items-center gap-0.5">{props.children}</div>
      )}
      {typeof props.count === "number" && props.count > 0 && (
        <span className="git-pane-count inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-[11px] font-medium text-muted-foreground">{props.count}</span>
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
      className="git-compact-filter-menu"
      role="listbox"
      style={menuStyle}
    >
      {props.options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`git-compact-filter-opt${option.value === props.value ? " active" : ""}`}
          role="option"
          aria-selected={option.value === props.value}
          title={option.label}
          onClick={() => {
            props.onChange(option.value);
            closeMenu();
          }}
        >
          <span className="git-compact-filter-opt-label">
            {option.label}
          </span>
          {option.value === props.value && (
            <Check size={12} className="git-compact-filter-check" />
          )}
        </button>
      ))}
    </div>
  ) : null;

  return (
    <div
      ref={containerRef}
      className={`git-compact-filter${props.className ? ` ${props.className}` : ""}`}
    >
      <button
        ref={buttonRef}
        type="button"
        className="git-compact-filter-btn"
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
        <span className="git-compact-filter-label">
          {selected?.label ?? props.value}
        </span>
        <ChevronDown
          size={12}
          className={`git-compact-filter-chevron${open ? " open" : ""}`}
        />
      </button>
      {menuElement && createPortal(menuElement, document.body)}
    </div>
  );
}
