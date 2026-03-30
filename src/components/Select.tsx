import { useState, useRef, useEffect } from "react";

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  className?: string;
  style?: React.CSSProperties;
}

export function Select({ value, onChange, options, className, style }: SelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function close(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const selected = options.find((o) => o.value === value);

  return (
    <div className={`custom-select ${open ? "open" : ""} ${className ?? ""}`} ref={ref} style={style}>
      <button type="button" className="custom-select-trigger" onClick={() => setOpen((v) => !v)}>
        <span>{selected?.label ?? value}</span>
        <span className="custom-select-arrow">▾</span>
      </button>
      {open && (
        <ul className="custom-select-menu">
          {options.map((o) => (
            <li
              key={o.value}
              className={`custom-select-option ${o.value === value ? "active" : ""}`}
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(o.value);
                setOpen(false);
              }}
            >
              {o.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
