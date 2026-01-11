import {
  Controller,
  useFormContext,
  FieldValues,
  Path,
} from "react-hook-form"
import {
  Field,
  FieldLabel,
  FieldContent,
  FieldDescription,
  FieldError,
} from "@/components/ui/field"

type RHFFieldProps<TFieldValues extends FieldValues> = {
  name: Path<TFieldValues>
  label?: React.ReactNode
  description?: React.ReactNode
  children: (field: any) => React.ReactNode
}

export function RHFField<TFieldValues extends FieldValues>({
  name,
  label,
  description,
  children,
}: RHFFieldProps<TFieldValues>) {
  const {
    control,
    getFieldState,
    formState,
  } = useFormContext<TFieldValues>()

  const { error } = getFieldState(name, formState)

  return (
    <Controller
      name={name}
      control={control}
      render={({ field }) => (
        <Field>
          {label && <FieldLabel>{label}</FieldLabel>}

          <FieldContent>
            {children(field)}
          </FieldContent>

          {description && (
            <FieldDescription>
              {description}
            </FieldDescription>
          )}

          <FieldError errors={[error]} />
        </Field>
      )}
    />
  )
}
