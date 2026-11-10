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
  max?: number;
  exclusiveMin?: boolean; // value must be strictly above min
};

/** Text input for numbers: friendly on mobile (decimal keypad), commits as you type. */
export function NumberField({ value, onChange, placeholder, allowEmpty = true, className, ariaLabel, integer, min, max, exclusiveMin }: Props) {
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
    if (min != null && (exclusiveMin ? n <= min : n < min)) return undefined;
    if (max != null && n > max) return undefined;
    return n;
  };

  const parsed = parse(text);
  const why =
    parsed !== undefined
      ? undefined
      : text.trim() === ""
        ? "Required"
        : !Number.isFinite(Number(text.trim()))
          ? "Not a number"
          : integer && !Number.isInteger(Number(text.trim()))
            ? "Whole numbers only"
            : max != null && Number(text.trim()) > max
              ? `Max ${max}`
              : `Must be ${exclusiveMin ? "more than" : "at least"} ${min}`;
  return (
    <input
      className={`num ${className ?? ""} ${parsed === undefined ? "invalid" : ""}`}
      inputMode={integer ? "numeric" : "decimal"}
      value={text}
      placeholder={placeholder}
      aria-label={ariaLabel}
      aria-invalid={parsed === undefined || undefined}
      title={why}
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
