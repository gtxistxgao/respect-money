import { Children, isValidElement, useRef, useState, type ButtonHTMLAttributes, type ComponentProps, type ReactNode } from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';

type SelectProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'value' | 'defaultValue'> & {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  required?: boolean;
};

function optionText(children: ReactNode): string {
  return Children.toArray(children).map((child) => typeof child === 'string' || typeof child === 'number' ? String(child) : '').join('');
}

// Keep declarative options at call sites; render the trigger and menu with our theme.
export function Select({ children, value, defaultValue, onValueChange, name, form, required, disabled, className = '', ...props }: SelectProps) {
  const options = Children.toArray(children).flatMap((child) => {
    if (!isValidElement<ComponentProps<'option'>>(child) || child.type !== 'option') return [];
    return [{ value: String(child.props.value ?? optionText(child.props.children)), label: child.props.children, disabled: child.props.disabled }];
  });
  const [internalValue, setInternalValue] = useState(defaultValue);
  const selected = value ?? internalValue ?? options[0]?.value ?? '';
  const trigger = useRef<HTMLButtonElement>(null);
  const [container, setContainer] = useState<HTMLElement | null>(null);
  // Prefix every value so the empty 'all accounts/default model' option is selectable.
  const encode = (value: string) => `value:${value}`;

  return <SelectPrimitive.Root value={encode(selected)} disabled={disabled} required={required} onValueChange={(encoded) => {
    const next = encoded.slice('value:'.length);
    if (value === undefined) setInternalValue(next);
    onValueChange?.(next);
  }} onOpenChange={(open) => {
    // Native modal dialogs make body portals inert; keep their menus in the dialog.
    if (open) setContainer(trigger.current?.closest('dialog') ?? null);
  }}>
    <SelectPrimitive.Trigger {...props} ref={trigger} disabled={disabled} className={`select-trigger ${className}`} data-value={selected}>
      <SelectPrimitive.Value /><SelectPrimitive.Icon asChild><ChevronDown className="select-chevron" size={14} aria-hidden="true" /></SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
    {name && <input type="hidden" name={name} form={form} value={selected} disabled={disabled} />}
    <SelectPrimitive.Portal container={container}>
      <SelectPrimitive.Content className="select-menu" position="popper" sideOffset={6} collisionPadding={12}>
        <SelectPrimitive.ScrollUpButton className="select-scroll"><ChevronUp size={14} aria-hidden="true" /></SelectPrimitive.ScrollUpButton>
        <SelectPrimitive.Viewport className="select-options">
          {options.map((option) => <SelectPrimitive.Item className="select-option" key={option.value} value={encode(option.value)} data-value={option.value} disabled={option.disabled} textValue={optionText(option.label)}>
            <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
            <SelectPrimitive.ItemIndicator className="select-check"><Check size={14} aria-hidden="true" /></SelectPrimitive.ItemIndicator>
          </SelectPrimitive.Item>)}
        </SelectPrimitive.Viewport>
        <SelectPrimitive.ScrollDownButton className="select-scroll"><ChevronDown size={14} aria-hidden="true" /></SelectPrimitive.ScrollDownButton>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  </SelectPrimitive.Root>;
}
