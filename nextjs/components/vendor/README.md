# Vendored components

`multi-select.tsx` is vendored from [sersavan/shadcn-multi-select-component](https://github.com/sersavan/shadcn-multi-select-component) and locally extended (tabs, option groups, `emptyFooter` for the offline create flow). Treat it as a leaf: import it from the wrappers (`player-multi-select`, `game-multi-select`, `ArenaForm`), don't refactor it without a UI reason.
