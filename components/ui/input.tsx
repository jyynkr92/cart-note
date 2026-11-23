import { cn } from '@/lib/utils';
import { Platform, TextInput } from 'react-native';

/**
 * 입력 칸 클래스(기본 + editable=false + 플랫폼별). Input과 시트 안의 입력 칸(SheetInput)이 함께 써서
 * 두 입력 칸의 모양이 갈라지지 않게 한다. 호출하는 쪽의 className은 뒤에 붙인다.
 */
function inputClassName(editable?: boolean): string {
  return cn(
    'dark:bg-input/30 border-input bg-background text-foreground flex h-10 w-full min-w-0 flex-row items-center rounded-md border px-3 py-1 text-base leading-5 shadow-sm shadow-black/5 sm:h-9',
    editable === false &&
      cn(
        'opacity-50',
        Platform.select({ web: 'disabled:pointer-events-none disabled:cursor-not-allowed' })
      ),
    Platform.select({
      web: cn(
        'placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground outline-none transition-[color,box-shadow] md:text-sm',
        'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
        'aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive'
      ),
      native: 'placeholder:text-muted-foreground/50',
    })
  );
}

function Input({
  className,
  ...props
}: React.ComponentProps<typeof TextInput> & React.RefAttributes<TextInput>) {
  return <TextInput className={cn(inputClassName(props.editable), className)} {...props} />;
}

export { Input, inputClassName };
