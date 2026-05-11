export const UndoLearningButton = () => (
  <button
    type="button"
    disabled
    aria-label="学習の取り消し"
    title="学習の取り消し"
    className="inline-flex items-center justify-center h-7 min-w-[2rem] rounded-md border border-emerald-300/50 bg-emerald-950/20 px-2 text-sm text-emerald-200 opacity-70 cursor-not-allowed shadow-sm shadow-black/20"
    style={{
      fontFamily: "ui-sans-serif, system-ui, sans-serif",
      fontVariantEmoji: "text",
    }}
  >
    ↩
  </button>
);
