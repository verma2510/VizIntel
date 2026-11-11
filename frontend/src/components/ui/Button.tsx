import React from "react";
import { LoaderCircle } from "lucide-react";
import { Link, type LinkProps } from "react-router-dom";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "ai" | "subtle";
export type ButtonSize = "xs" | "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-[background-color,border-color,color,box-shadow,transform] duration-150 select-none disabled:pointer-events-none disabled:opacity-50 active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-brand text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.18),0_1px_2px_rgb(13_16_23/0.2)] hover:bg-brand-strong",
  secondary: "border border-line bg-surface text-ink shadow-card-sm hover:border-line-strong hover:bg-surface-2",
  ghost: "text-ink-2 hover:bg-surface-3 hover:text-ink",
  subtle: "bg-surface-3 text-ink hover:bg-line",
  danger: "bg-bad text-white hover:opacity-90",
  ai: "bg-volt text-volt-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.35),0_1px_2px_rgb(13_16_23/0.18)] hover:brightness-95",
};

const sizes: Record<ButtonSize, string> = {
  xs: "h-7 rounded-md px-2 text-xs",
  sm: "h-8 rounded-lg px-3 text-[13px]",
  md: "h-9 rounded-lg px-3.5 text-sm",
  lg: "h-11 rounded-xl px-5 text-[15px]",
};

const iconSizes: Record<ButtonSize, string> = {
  xs: "h-7 w-7 rounded-md",
  sm: "h-8 w-8 rounded-lg",
  md: "h-9 w-9 rounded-lg",
  lg: "h-11 w-11 rounded-xl",
};

const buttonClass = (variant: ButtonVariant = "primary", size: ButtonSize = "md", iconOnly = false, className = "") =>
  `${base} ${variants[variant]} ${iconOnly ? iconSizes[size] : sizes[size]} ${className}`;

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  iconOnly?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ children, variant = "primary", size = "md", isLoading = false, iconOnly = false, className = "", disabled, type = "button", ...props }, ref) => (
    <button ref={ref} type={type} className={buttonClass(variant, size, iconOnly, className)} disabled={disabled || isLoading} aria-busy={isLoading || undefined} {...props}>
      {isLoading && <LoaderCircle size={size === "lg" ? 18 : 15} className="animate-spin" aria-hidden="true" />}
      {children}
    </button>
  )
);
Button.displayName = "Button";

export const ButtonLink: React.FC<LinkProps & { variant?: ButtonVariant; size?: ButtonSize; iconOnly?: boolean }> = ({
  variant = "primary",
  size = "md",
  iconOnly = false,
  className = "",
  ...props
}) => <Link className={buttonClass(variant, size, iconOnly, String(className))} {...props} />;
