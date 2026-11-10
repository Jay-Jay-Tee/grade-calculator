import { useEffect, useRef, useState } from "react";

type Props = {
  value: number | null;
  onChange: (v: number | null) => void;
  placeholder?: string;
  allowEmpty?: boolean;
  className?: string;
  ariaLabel?: string;
  integer?: boolean;
  min?: number;
};

/** Text input for numbers: friendly on mobile (decimal keypad), commits as you type. */
export function NumberField({ value, onChange, placeholder, allowEmpty = true, className, ariaLabel, integer, min }: Props) {
  const [text, setText] = useState(value == null ? "" : String(value));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(value == null ? "" : String(value));
  }, [value]);

  const parse = (t: string): number | null | undefined => {
    const s = t.trim();
    if (s === "" || s === "-") return allowEmpty ? null : undefined;
    const n = Number(s);
    if (!Number.isFinite(n)) return undefined;
    if (integer && !Number.isInteger(n)) return undefined;
    if (min != null && n < min) return undefined;
    return n;
  };

  const parsed = parse(text);
  return (
    <input
      className={`num ${className ?? ""} ${parsed === undefined ? "invalid" : ""}`}
      inputMode={integer ? "numeric" : "decimal"}
      value={text}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onFocus={(e) => {
        focused.current = true;
        e.currentTarget.select();
      }}
      onBlur={() => {
        focused.current = false;
        setText(value == null ? "" : String(value));
      }}
      onChange={(e) => {
        setText(e.target.value);
        const v = parse(e.target.value);
        if (v !== undefined && v !== value) onChange(v);
      }}
    />
  );
}
