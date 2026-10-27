interface Window {
  google?: { accounts: { id: {
    initialize(options: Record<string, unknown>): void;
    renderButton(element: HTMLElement, options: Record<string, unknown>): void;
  } } };
}
