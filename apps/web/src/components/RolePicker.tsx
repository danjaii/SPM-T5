"use client";

import type { Role } from "@spm-t5/shared";
import { ROLE_OPTIONS } from "@/lib/roles";

interface Props {
  legend: string;
  value: Role;
  onChange: (role: Role) => void;
  error?: string;
}

export function RolePicker({ legend, value, onChange, error }: Props) {
  return (
    <fieldset className="roles">
      <legend className="legend">{legend}</legend>
      <div className="role-list">
        {ROLE_OPTIONS.map((option) => (
          <label key={option.value} className="role-option" data-selected={value === option.value}>
            <input
              type="radio"
              name="role"
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            <span className="role-option__radio" aria-hidden="true" />
            <span>
              <span className="role-option__title">{option.label}</span>
              <span className="role-option__desc">{option.description}</span>
            </span>
          </label>
        ))}
      </div>
      {error && <p className="field__error">{error}</p>}
    </fieldset>
  );
}
