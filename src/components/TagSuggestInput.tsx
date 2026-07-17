import { useRef, useState } from "react";

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** Every known value to suggest from (e.g. every gear tag or member name
   * already used anywhere in the event) — deduping/collecting is the
   * caller's job since what counts as "known" differs per field. */
  suggestions: string[];
  placeholder?: string;
  title?: string;
  className?: string;
}

const MAX_SUGGESTIONS = 6;

// Comma-separated free-text input (members, gear tags — matches the
// existing "type a list, split on commas" convention used throughout this
// app) with a live-filtered dropdown of already-used values for whichever
// segment is currently being typed. The point isn't new capability — you
// could always just type the right spelling — it's catching a typo at the
// moment it would happen instead of after the fact via the Name
// Resolution flow, the same way Notion/Linear's tag pickers suggest
// existing tags instead of letting every keystroke mint a new one.
export function TagSuggestInput({
  value,
  onChange,
  suggestions,
  placeholder,
  title,
  className = "",
}: Props) {
  const [isFocused, setIsFocused] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const segments = value.split(",");
  const currentSegment = (segments[segments.length - 1] ?? "").trim();
  const priorSegments = new Set(
    segments.slice(0, -1).map((s) => s.trim()).filter(Boolean),
  );

  // Suggestion pools here are event-sized (dozens, not thousands) so
  // recomputing on every keystroke rather than memoizing is cheap — a
  // useMemo keyed on priorSegments wouldn't actually cache anything anyway
  // since that Set is freshly built every render.
  const matches = currentSegment
    ? [...new Set(suggestions)]
        .filter((s) => s && !priorSegments.has(s) && s.toLowerCase() !== currentSegment.toLowerCase())
        .filter((s) => s.toLowerCase().includes(currentSegment.toLowerCase()))
        .slice(0, MAX_SUGGESTIONS)
    : [];

  const showDropdown = isFocused && matches.length > 0;

  function applySuggestion(suggestion: string) {
    const newSegments = [...segments.slice(0, -1), ` ${suggestion}`];
    onChange(newSegments.map((s) => s.trim()).join(", ") + ", ");
    setHighlightIndex(0);
    inputRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!showDropdown) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIndex((i) => (i + 1) % matches.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIndex((i) => (i - 1 + matches.length) % matches.length);
    } else if (e.key === "Enter" && matches[highlightIndex]) {
      e.preventDefault();
      applySuggestion(matches[highlightIndex]);
    } else if (e.key === "Escape") {
      setIsFocused(false);
    }
  }

  return (
    <div className="relative">
      <input
        ref={inputRef}
        value={value}
        placeholder={placeholder}
        title={title}
        onChange={(e) => {
          onChange(e.target.value);
          setHighlightIndex(0);
        }}
        onFocus={() => setIsFocused(true)}
        // A plain onBlur would close the dropdown before the click on a
        // suggestion below it gets a chance to register — deferring one
        // tick lets that click's onMouseDown-triggered focus/logic land
        // first (see applySuggestion re-focusing the input).
        onBlur={() => window.setTimeout(() => setIsFocused(false), 120)}
        onKeyDown={handleKeyDown}
        className={className}
      />
      {showDropdown && (
        <ul className="absolute left-0 top-full z-50 mt-0.5 w-full min-w-[10rem] overflow-hidden rounded-md border border-slate-600 bg-slate-800 shadow-lg shadow-black/40">
          {matches.map((m, i) => (
            <li key={m}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => applySuggestion(m)}
                className={`block w-full truncate px-2 py-1.5 text-left text-xs ${
                  i === highlightIndex
                    ? "bg-indigo-600 text-white"
                    : "text-slate-200 hover:bg-slate-700"
                }`}
              >
                {m}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
