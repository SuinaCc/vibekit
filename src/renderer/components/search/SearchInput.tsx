import { createEffect, createSignal } from 'solid-js';

interface SearchInputProps {
  value: string;
  onInput: (value: string) => void;
}

export default function SearchInput(props: SearchInputProps) {
  let inputRef!: HTMLInputElement;
  const [isFocused, setIsFocused] = createSignal(false);

  createEffect(() => {
    if (inputRef) {
      inputRef.focus();
    }
  });

  return (
    <div
      class="search-input-wrapper"
      classList={{
        'search-input-focused': isFocused(),
      }}
    >
      <svg
        class="search-icon"
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3" />
      </svg>

      <input
        ref={inputRef}
        type="text"
        class="search-input"
        placeholder="搜索插件，或输入自动化命令…"
        value={props.value}
        onInput={(e) => props.onInput(e.currentTarget.value)}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        spellcheck={false}
        autocomplete="off"
      />

      {props.value.length > 0 && (
        <button
          class="search-clear-btn"
          onClick={() => props.onInput('')}
          aria-label="清除搜索"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      )}

      <div class="search-input-glow" />
    </div>
  );
}
