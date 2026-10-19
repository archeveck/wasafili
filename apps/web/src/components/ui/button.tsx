import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import { type ButtonHTMLAttributes, forwardRef } from 'react';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-[color,background-color,border-color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-accent/35 disabled:pointer-events-none disabled:opacity-50 aria-busy:cursor-progress [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground shadow-xs hover:bg-primary/90 active:bg-primary/95',
        outline:
          'border border-border bg-surface text-foreground shadow-xs hover:border-foreground/20 hover:bg-subtle active:bg-border/60',
        ghost: 'text-foreground hover:bg-subtle active:bg-border/60',
        danger: 'bg-danger text-white shadow-xs hover:bg-danger/90 active:bg-danger/95',
        link: 'text-accent underline-offset-4 hover:underline',
      },
      size: { default: 'h-9 px-4', sm: 'h-8 px-3 text-xs', icon: 'size-9', lg: 'h-10 px-6' },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild, type, ...props }, ref) => {
    const Component = asChild ? Slot.Root : 'button';
    return (
      <Component
        ref={ref}
        type={asChild ? undefined : (type ?? 'button')}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';
