import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Twistie } from "./GitResourceTree";

export function PaneHeader(props: {
  id: string;
  title: string;
  count?: number;
  open: boolean;
  onToggle: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="git-pane-header">
      <button
        type="button"
        className="git-pane-header-toggle"
        aria-expanded={props.open}
        aria-controls={`git-pane-${props.id}`}
        onClick={props.onToggle}
      >
        <Twistie open={props.open} />
        <span className="git-pane-title">{props.title}</span>
      </button>
      {props.children && (
        <div className="git-pane-header-actions">{props.children}</div>
      )}
      {typeof props.count === "number" && props.count > 0 && (
        <span className="git-pane-count">{props.count}</span>
      )}
    </div>
  );
}

/**
 * Compact Git pane filter with the app's listbox behavior instead of the
 * platform-native select, so pane headers render consistently on Windows.
 */
export function GitCompactFilter(props: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  ariaLabel: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const selected = props.options.find((option) => option.value === props.value);

  return (
    <div
      ref={containerRef}
      className={`git-compact-filter${props.className ? ` ${props.className}` : ""}`}
    >
      <button
        type="button"
        className="git-compact-filter-btn"
        aria-label={props.ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
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
      {open && (
        <div className="git-compact-filter-menu" role="listbox">
          {props.options.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`git-compact-filter-opt${option.value === props.value ? " active" : ""}`}
              role="option"
              aria-selected={option.value === props.value}
              onClick={() => {
                props.onChange(option.value);
                setOpen(false);
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
      )}
    </div>
  );
}
