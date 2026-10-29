import type { OptionValues, ToolOption } from "../types";

interface Props {
  options: ToolOption[];
  values: OptionValues;
  onChange: (values: OptionValues) => void;
}

/** Renders a tool's declared options (enum -> select, boolean -> checkbox) with no tool-specific code. */
export function OptionsBar({ options, values, onChange }: Props) {
  if (options.length === 0) return null;
  const set = (id: string, v: string | boolean) => onChange({ ...values, [id]: v });
  return (
    <div className="options" role="group" aria-label="Options">
      {options.map((o) =>
        o.type === "enum" ? (
          <label key={o.id} className="options__item">
            <span>{o.label}</span>
            <select value={String(values[o.id])} onChange={(e) => set(o.id, e.target.value)}>
              {o.values?.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label key={o.id} className="options__item options__item--check">
            <input type="checkbox" checked={Boolean(values[o.id])} onChange={(e) => set(o.id, e.target.checked)} />
            <span>{o.label}</span>
          </label>
        ),
      )}
    </div>
  );
}

export const defaultOptions = (options: ToolOption[] = []): OptionValues => Object.fromEntries(options.map((o) => [o.id, o.default]));
