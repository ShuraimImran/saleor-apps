import * as React from "react";

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
}

export const Select: React.FC<SelectProps> = ({
  value,
  onChange,
  options,
  placeholder,
  disabled = false,
}) => {
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <select
        disabled
        style={{
          padding: "12px",
          fontSize: "14px",
          borderRadius: "4px",
          border: "1px solid #ccc",
          width: "100%",
          backgroundColor: "#f5f5f5",
        }}
      >
        <option>{placeholder || "Loading..."}</option>
      </select>
    );
  }

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      style={{
        padding: "12px",
        fontSize: "14px",
        borderRadius: "4px",
        border: "1px solid #ccc",
        width: "100%",
        backgroundColor: disabled ? "#f5f5f5" : "white",
      }}
    >
      {placeholder && (
        <option value="" disabled>
          {placeholder}
        </option>
      )}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
};