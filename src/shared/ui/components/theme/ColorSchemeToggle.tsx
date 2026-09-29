import type { LocalColorScheme } from "./useLocalColorScheme";

type Props = {
  colorScheme: LocalColorScheme;
  onToggle: () => void;
  className?: string;
};

export function ColorSchemeToggle({
  colorScheme,
  onToggle,
  className = "",
}: Props) {
  const nextMode = colorScheme === "dark" ? "clair" : "sombre";

  return (
    <button
      type="button"
      className={className}
      onClick={onToggle}
      aria-label={`Activer le mode ${nextMode}`}
      title={`Activer le mode ${nextMode}`}
    >
      <span aria-hidden="true">{colorScheme === "dark" ? "☀" : "☾"}</span>
      <span className="colorSchemeToggle__label">
        {colorScheme === "dark" ? "Mode clair" : "Mode sombre"}
      </span>
    </button>
  );
}
