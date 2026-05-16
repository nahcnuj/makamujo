export function suppressDebugConsoleInProduction(): void {
  if (process.env.NODE_ENV !== 'production') {
    return;
  }

  const originalConsoleLog = console.log.bind(console);

  console.debug = () => { /* suppress debug output in production */ };
  console.log = (...args: unknown[]) => {
    if (args.length > 0 && typeof args[0] === 'string' && args[0].startsWith('[DEBUG]')) {
      return;
    }

    originalConsoleLog(...args);
  };
}
