/** 複数コマンドで共有するオプション宣言。 */

/**
 * `--in-place` と `--suffix`。書き戻すコマンドが両方を持つ。
 * `-i.bak` は `-i --suffix .bak` に展開される（`command.ts` の `hasInlineSuffix`）。
 */
export const IN_PLACE_OPTIONS = {
  "in-place": {
    type: "boolean",
    short: "i",
    default: false,
    description: "write the model back; -iSUFFIX keeps a backup first",
  },
  /** `-i.bak` の受け皿。内部用なので usage にもヘルプにも出さない。 */
  suffix: {
    type: "string",
    default: "",
  },
} as const;

export const DELIMITER_OPTION = {
  delimiter: {
    type: "string",
    short: "d",
    default: " ",
    value: "DELIM",
    description: "delimiter inside the phrase",
  },
} as const;
