import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useNavigationType } from "react-router-dom";

const NavigationBackContext = createContext({
  canGoBack: false,
  goBack: () => {},
  setPageBackHandler: () => {},
});

export function NavigationBackProvider({ children }) {
  const location = useLocation();
  const navigationType = useNavigationType();
  const navigate = useNavigate();
  const stackRef = useRef([]);
  const pageBackRef = useRef(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [hasPageBack, setHasPageBack] = useState(false);

  useEffect(() => {
    const key = location.key || "default";
    const stack = stackRef.current;

    if (navigationType === "POP") {
      const idx = stack.lastIndexOf(key);
      stackRef.current = idx >= 0 ? stack.slice(0, idx + 1) : [key];
    } else if (navigationType === "REPLACE") {
      if (stack.length === 0) stackRef.current = [key];
      else {
        const next = stack.slice();
        next[next.length - 1] = key;
        stackRef.current = next;
      }
    } else if (stack[stack.length - 1] !== key) {
      stackRef.current = [...stack, key];
    }

    setCanGoBack(stackRef.current.length > 1 || Boolean(pageBackRef.current));
  }, [location.key, navigationType]);

  const setPageBackHandler = useCallback((handler) => {
    pageBackRef.current = typeof handler === "function" ? handler : null;
    setHasPageBack(Boolean(pageBackRef.current));
    setCanGoBack(stackRef.current.length > 1 || Boolean(pageBackRef.current));
  }, []);

  const value = useMemo(
    () => ({
      canGoBack: canGoBack || hasPageBack,
      goBack: () => {
        if (typeof pageBackRef.current === "function") {
          pageBackRef.current();
          return;
        }
        if (stackRef.current.length <= 1) return;
        navigate(-1);
      },
      setPageBackHandler,
    }),
    [canGoBack, hasPageBack, navigate, setPageBackHandler]
  );

  return <NavigationBackContext.Provider value={value}>{children}</NavigationBackContext.Provider>;
}

export function useNavigationBack() {
  return useContext(NavigationBackContext);
}
