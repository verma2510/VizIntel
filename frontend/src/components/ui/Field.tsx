import React, { forwardRef, useId } from "react";
import { ChevronDown, Search, X } from "lucide-react";

export const inputClass =
  "w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink placeholder:text-ink-3 shadow-card-sm transition-[border-color,box-shadow] outline-none hover:border-line-strong focus:border-brand focus:ring-4 focus:ring-brand-soft disabled:opacity-60";

export const Label: React.FC<{ htmlFor?: string; children: React.ReactNode; hint?: React.ReactNode; className?: string }> = ({ htmlFor, children, hint, className = "" }) => (
  <div className={`mb-1.5 flex items-baseline justify-between gap-2 ${className}`}>
    <label htmlFor={htmlFor} className="text-[13px] font-medium text-ink-2">
      {children}
    </label>
    {hint && <span className="text-xs text-ink-3">{hint}</span>}
  </div>
);

interface TextfieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: React.ReactNode;
  leading?: React.ReactNode;
}

export const Textfield = forwardRef<HTMLInputElement, TextfieldProps>(({ label, error, hint, leading, className = "", id, ...props }, ref) => {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div className="w-full">
      {label && (
        <Label htmlFor={inputId} hint={hint}>
          {label}
        </Label>
      )}
      <div className="relative">
        {leading && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3">{leading}</span>}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${inputId}-error` : undefined}
          className={`${inputClass} h-10 ${leading ? "pl-9" : ""} ${error ? "border-bad focus:border-bad focus:ring-bad-soft" : ""} ${className}`}
          {...props}
        />
      </div>
      {error && (
        <p id={`${inputId}-error`} className="mt-1.5 text-xs text-bad">
          {error}
        </p>
      )}
    </div>
  );
});
Textfield.displayName = "Textfield";

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className = "", ...props }, ref) => (
  <textarea ref={ref} className={`${inputClass} min-h-24 py-2 leading-relaxed ${className}`} {...props} />
));
Textarea.displayName = "Textarea";

interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "size"> {
  options: { value: string; label: string; disabled?: boolean }[];
  placeholder?: string;
  size?: "sm" | "md";
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(({ options, placeholder, className = "", size = "md", ...props }, ref) => (
  <div className={`relative ${className}`}>
    <select ref={ref} className={`${inputClass} appearance-none pr-8 ${size === "sm" ? "h-8 text-[13px]" : "h-9"}`} {...props}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
    <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
  </div>
));
Select.displayName = "Select";

interface SearchInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange"> {
  value: string;
  onChange: (value: string) => void;
  busy?: boolean;
}

export const SearchInput: React.FC<SearchInputProps> = ({ value, onChange, busy, className = "", placeholder = "Search…", ...props }) => (
  <div className={`relative ${className}`}>
    <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
    <input
      type="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`${inputClass} h-9 pl-9 pr-8 [&::-webkit-search-cancel-button]:hidden`}
      {...props}
    />
    {value && !busy && (
      <button type="button" onClick={() => onChange("")} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-ink-3 hover:bg-surface-3 hover:text-ink">
        <X size={14} />
      </button>
    )}
    {busy && <span className="absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin rounded-full border-2 border-line-strong border-t-brand" aria-hidden="true" />}
  </div>
);

export const Switch: React.FC<{ checked: boolean; onChange: (checked: boolean) => void; label: string; description?: string; disabled?: boolean }> = ({
  checked,
  onChange,
  label,
  description,
  disabled,
}) => (
  <label className={`flex items-start justify-between gap-4 ${disabled ? "opacity-60" : "cursor-pointer"}`}>
    <span>
      <span className="block text-sm font-medium text-ink">{label}</span>
      {description && <span className="mt-0.5 block text-[13px] text-ink-3">{description}</span>}
    </span>
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${checked ? "bg-brand" : "bg-line-strong"}`}
    >
      <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-[18px]" : "translate-x-0.5"}`} />
    </button>
  </label>
);
