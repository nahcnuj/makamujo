// CookieClicker is implemented in makamujo and should not depend on automated-gameplay-transmitter exports.
// This module provides only the `sight` probe for browser evaluation.

export const sight = () => ({
  // 投機的な状態データ: 既存アーキテクチャでは `state` をマージするための空オブジェクトでOK
  game: 'CookieClicker',
  timestamp: Date.now(),
});

export { default as Component } from "./ReactComponent";
export { solver } from "./solver";
