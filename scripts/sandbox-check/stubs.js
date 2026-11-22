// Stand-ins for React and zreader/react: the checks use the Sandbox directly.
export const useMemo = (fn) => fn();
export const useRegisterSandbox = () => {};
export const useRef = (v) => ({ current: v });
