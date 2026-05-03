type NewItemsButtonProps = {
  count: number;
  onClick: () => void;
};

export const NewItemsButton = ({ count, onClick }: NewItemsButtonProps) => (
  <button
    type="button"
    onClick={onClick}
    className="sticky top-0 z-10 w-full mb-2 py-1 px-2 text-xs text-center bg-emerald-800/90 text-emerald-100 rounded border border-emerald-300/50 hover:bg-emerald-700/90 cursor-pointer"
  >
    ↑ 新しい発話が {count} 件あります
  </button>
);
