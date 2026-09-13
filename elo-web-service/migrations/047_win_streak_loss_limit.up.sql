-- Win-streak loss-limit semantics: max_losses used to mean "the market
-- resolves Нет once the target has suffered MORE than max_losses defeats"; it
-- now means "…once max_losses defeats have been suffered" ("либо допускает
-- max_losses поражений"). A limit of x under the old strict rule fires at
-- exactly x+1 defeats, which the new rule reproduces with the stored limit
-- x+1 — so every existing market keeps its original deal, and the displayed
-- condition states truthfully when it actually resolved. Only completed
-- markets exist in production (no open ones), so no live market changes
-- behavior mid-flight. A legacy limit of 0 ("any defeat loses") maps to 1.
UPDATE market_win_streak_params
SET max_losses = max_losses + 1
WHERE max_losses IS NOT NULL;
