import { useEffect, useRef, useState } from "react";

import { createForecastLedgerTools } from "./forecast-tools.js";

function afterPaint() {
  if (typeof requestAnimationFrame !== "function") return Promise.resolve();
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

export function useForecastLedgerTools({
  queries,
  exploreDashboard,
  setActivity,
  setSelectedDate,
  setLedgerMode,
  setLedgerOrder,
  setLedgerBaseline,
  setProtocolTopic,
  setComparison,
}) {
  const [registration, setRegistration] = useState({ status: "checking", count: 0 });
  const stateRef = useRef(null);
  stateRef.current = {
    queries,
    async updateView(view) {
      if (view.ledgerMode) setLedgerMode(view.ledgerMode);
      if (view.ledgerOrder) setLedgerOrder(view.ledgerOrder);
      if (view.ledgerBaseline) setLedgerBaseline(view.ledgerBaseline);
      if (view.selectedDate) setSelectedDate(view.selectedDate);
      if (view.protocolTopic) setProtocolTopic(view.protocolTopic);
      if (Object.hasOwn(view, "comparison")) setComparison(view.comparison);
      if (view.activity) setActivity({ origin: "agent", ...view.activity });
      if (view.tab) {
        await Promise.resolve(exploreDashboard(view.tab, { filters: {}, focus: {} }));
      }
      await afterPaint();
    },
  };

  useEffect(() => {
    const context = typeof document === "undefined" ? undefined : document.modelContext;
    if (typeof context?.registerTool !== "function") {
      setRegistration({ status: "unsupported", count: 0 });
      return undefined;
    }

    const lifecycle = new AbortController();
    const tools = createForecastLedgerTools(() => stateRef.current);
    let active = true;

    Promise.all(tools.map(async (tool) => {
      await context.registerTool(tool, { signal: lifecycle.signal });
    })).then(() => {
      if (active) setRegistration({ status: "ready", count: tools.length });
    }).catch((error) => {
      console.error("Unable to register Forecast Ledger tools.", error);
      if (active) setRegistration({ status: "error", count: 0 });
    });

    return () => {
      active = false;
      lifecycle.abort();
      tools.forEach((tool) => context.unregisterTool?.(tool.name));
    };
  }, []);

  return registration;
}
