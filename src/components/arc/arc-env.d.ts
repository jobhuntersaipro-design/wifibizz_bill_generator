// Arc targets TypeScript 6, whose DOM lib knows FocusOptions.focusVisible; TypeScript 5.9 does not yet.
interface FocusOptions {
  focusVisible?: boolean;
}
